#!/usr/bin/env node
/* check-deploy — verifica o deploy público do Azure Edge de ponta a ponta:
 *   1. server-game: GET <server>/healthz -> 200 + {"ok":true, zone, tick, players, mobs}
 *   2. client:      GET <client>/        -> 200 + corpo não vazio
 *   3. WebSocket:   abre ws(s)://<server>/ e espera o `open` (--ws)
 *
 * Uso:
 *   node apps/tools/check-deploy.mjs --server https://azure-edge-server-game.onrender.com --client https://<site>.netlify.app --ws
 *   GAME_SERVER_URL=... CLIENT_URL=... node apps/tools/check-deploy.mjs --ws
 * Sem --client, só verifica o servidor. Sem --ws, pula o handshake WS.
 * Exit 0 = tudo PASS; 1 = alguma checagem FAIL. Só stdlib Node
 * (WebSocket global existe no Node 22+).
 */
import { get } from "node:http";
import { get as getHttps } from "node:https";

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const serverBase = (argValue("--server") ?? process.env.GAME_SERVER_URL ?? "").replace(/\/$/, "");
const clientBase = (argValue("--client") ?? process.env.CLIENT_URL ?? "").replace(/\/$/, "");
const checkWs = args.includes("--ws");
const timeoutMs = Number(argValue("--timeout-ms") ?? 20000);

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

function httpGet(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const getter = url.startsWith("https://") ? getHttps : get;
    const req = getter(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, ms: Date.now() - started, body, headers: res.headers }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout após ${timeoutMs} ms`)));
    req.on("error", (err) => resolve({ status: null, ms: Date.now() - started, body: "", error: String(err.message ?? err) }));
  });
}

if (!serverBase) {
  console.error("Falta a URL do servidor: passe --server <url> ou GAME_SERVER_URL.");
  process.exit(2);
}

// 1. /healthz do server-game
{
  const r = await httpGet(`${serverBase}/healthz`);
  if (r.status === 200) {
    try {
      const j = JSON.parse(r.body);
      report(
        "server /healthz",
        j.ok === true,
        `HTTP ${r.status} em ${r.ms} ms — zone=${j.zone ?? "?"} tick=${j.tick ?? "?"} players=${j.players ?? "?"} mobs=${j.mobs ?? "?"}`,
      );
    } catch {
      report("server /healthz", false, `HTTP ${r.status} mas o corpo não é JSON: ${r.body.slice(0, 120)}`);
    }
  } else {
    report("server /healthz", false, r.error ?? `HTTP ${r.status ?? "sem resposta"} em ${r.ms} ms`);
  }
}

// 2. client estático (opcional)
if (clientBase) {
  const r = await httpGet(`${clientBase}/`);
  const isHtml = String(r.headers?.["content-type"] ?? "").includes("text/html");
  report(
    "client /",
    r.status === 200 && r.body.length > 0,
    r.status === 200
      ? `HTTP 200 em ${r.ms} ms — ${r.body.length} bytes${isHtml ? " (HTML)" : ` (content-type: ${r.headers?.["content-type"] ?? "?"})`}`
      : (r.error ?? `HTTP ${r.status ?? "sem resposta"} em ${r.ms} ms`),
  );
} else {
  console.log("SKIP  client /  (sem --client / CLIENT_URL)");
}

// 3. handshake WebSocket (opcional)
if (checkWs) {
  const wsUrl = serverBase.replace(/^http/, "ws");
  const wsOk = await new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const finish = (pass, detail) => {
      if (!done) {
        done = true;
        resolve({ pass, detail: `${detail} em ${Date.now() - started} ms` });
      }
    };
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      finish(false, `não foi possível criar o WebSocket: ${String(err.message ?? err)}`);
      return;
    }
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* já fechado */
      }
      finish(false, "timeout aguardando open");
    }, timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* já fechado */
      }
      finish(true, `handshake WS OK (${wsUrl})`);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      finish(false, `erro no handshake WS (${wsUrl}) — o serviço pode estar dormindo (Render free) ou a URL está errada`);
    });
  });
  report("websocket", wsOk.pass, wsOk.detail);
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed === 0 ? "check-deploy: tudo OK." : `check-deploy: ${failed} checagem(ns) falharam.`);
process.exitCode = failed === 0 ? 0 : 1;
