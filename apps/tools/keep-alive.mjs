#!/usr/bin/env node
/* keep-alive — pinga o /healthz do server-game para impedir o sleep do
 * plano free do Render (dorme após 15 min sem tráfego; acorda em ~1 min).
 *
 * Uso (uma chamada = um ping; rode via cron a cada 10 min):
 *   node apps/tools/keep-alive.mjs
 *   GAME_SERVER_URL=https://azure-edge-server-game.onrender.com node apps/tools/keep-alive.mjs
 *   node apps/tools/keep-alive.mjs --url http://127.0.0.1:3001 --timeout-ms 15000
 *   node apps/tools/keep-alive.mjs --loop --interval-min 10   # daemon local
 *
 * Só stdlib Node — sem dependências. O servidor responde /healthz com
 * 200 + {"ok":true,...}; qualquer outra coisa é falha (exit 1).
 * ATENÇÃO ao orçamento: um serviço sempre acordado consome ~720 h/mês
 * das 750 h grátis do workspace Render. O keep-alive só vale a pena
 * enquanto houver UM único serviço free no workspace; com 2+ serviços
 * free sempre acordados as horas acabam e tudo é suspenso até o mês
 * seguinte. Ver deploy/keep-alive.cron e DEPLOY.md.
 */
import { get } from "node:http";
import { get as getHttps } from "node:https";

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const base = (argValue("--url") ?? process.env.GAME_SERVER_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const url = `${base}/healthz`;
const timeoutMs = Number(argValue("--timeout-ms") ?? process.env.KEEP_ALIVE_TIMEOUT_MS ?? 15000);
const loop = args.includes("--loop");
const intervalMin = Number(argValue("--interval-min") ?? process.env.KEEP_ALIVE_INTERVAL_MIN ?? 10);

if (loop && intervalMin > 14) {
  console.error(`[keep-alive] AVISO: intervalo de ${intervalMin} min > 15 min de sleep do Render — o serviço vai dormir entre os pings. Use 10 min.`);
}

function log(fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), tool: "keep-alive", url, ...fields }));
}

function pingOnce() {
  return new Promise((resolve) => {
    const started = Date.now();
    const getter = url.startsWith("https://") ? getHttps : get;
    const req = getter(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const ms = Date.now() - started;
        let ok = false;
        try {
          ok = res.statusCode === 200 && JSON.parse(body).ok === true;
        } catch {
          ok = false;
        }
        log({ status: res.statusCode, ms, ok, body: body.slice(0, 200) });
        resolve(ok);
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`timeout após ${timeoutMs} ms`));
    });
    req.on("error", (err) => {
      log({ status: null, ms: Date.now() - started, ok: false, error: String(err.message ?? err) });
      resolve(false);
    });
  });
}

if (!loop) {
  process.exitCode = (await pingOnce()) ? 0 : 1;
} else {
  // Daemon: um ping imediato e depois a cada intervalo; falha isolada
  // só é registrada, o loop continua. Ctrl+C encerra limpo.
  let timer = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    log({ msg: "encerrando" });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await pingOnce();
  timer = setInterval(() => void pingOnce(), intervalMin * 60 * 1000);
  log({ msg: "loop ativo", intervalMin });
}
