// Neferet GLB: front 8.5 m + close-up nas Tumbas (dungeon dela) e na cidade,
// lado + costas via ?testmobry= (2.5D, gira o test mob).
// Uso: node verify_neferet_glb.mjs  (server-game local na :3001 requerido)
import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";

const OUT = "/home/hatch/workspace/azure-edge/docs/visual-verify/";
const DIST = "/home/hatch/workspace/azure-edge/apps/client/dist";
const BASE = "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mime = (p) =>
  p.endsWith(".html") ? "text/html" :
  p.endsWith(".js") ? "text/javascript" :
  p.endsWith(".css") ? "text/css" :
  p.endsWith(".png") ? "image/png" :
  p.endsWith(".jpg") || p.endsWith(".jpeg") ? "image/jpeg" :
  p.endsWith(".glb") ? "model/gltf-binary" :
  p.endsWith(".json") ? "application/json" :
  p.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
const sha = "8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6";

const browser = await chromium.launch({
  executablePath: "/opt/meta-chromium/chrome",
  ignoreDefaultArgs: ["--disable-features"],
  args: [
    "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--window-size=1280,720", "--no-proxy-server",
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests",
    "--local-network-access-allowed-for-urls=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001,ws://localhost:3001,ws://127.0.0.1:3001",
    "--hatch-webgl-allowed-domains-file=/home/hatch/workspace/azure-edge/work/verify/webgl-allowed-domains.txt",
    `--hatch-webgl-allowed-domains-sha256=${sha}`,
  ],
});

async function neferetState(page) {
  return page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    const test = v.testMobs.map((e) => ({
      mobId: e.mobId, glb: !!e.glb,
      rotY: +e.group.rotation.y.toFixed(2),
      pos: [+e.group.position.x.toFixed(1), +e.group.position.z.toFixed(1)],
    }));
    const r = v.renderer.info.render;
    return {
      backend: v.backend, zoom: +v.zoom25DValue.toFixed(1),
      calls: r.calls ?? r.drawCalls, tris: r.triangles, test,
    };
  });
}

async function waitNeferetGlb(page, tag, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await neferetState(page);
    if (s && s.test.some((t) => t.mobId === "neferet" && t.glb)) return s;
    await sleep(700);
  }
  return neferetState(page);
}

async function capShot(page, cdp, name) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(3000);
  let data = null;
  for (let a = 0; a < 3 && !data; a += 1) {
    try { ({ data } = await cdp.send("Page.captureScreenshot", { format: "png" })); }
    catch { await sleep(3000); }
  }
  await page.setViewportSize({ width: 320, height: 180 });
  if (!data) throw new Error(`shot failed: ${name}`);
  await writeFile(`${OUT}${name}.png`, Buffer.from(data, "base64"));
  console.log(name, "captured");
}

async function zone(url, fn, tag) {
  const context = await browser.newContext({ viewport: { width: 320, height: 180 } });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") { await route.abort(); return; }
    let rel = decodeURIComponent(u.pathname);
    if (rel === "/") rel = "/index.html";
    try { await route.fulfill({ body: await readFile(`${DIST}${rel}`), contentType: mime(rel), status: 200 }); }
    catch { await route.fulfill({ body: "not found", status: 404 }); }
  });
  page.on("pageerror", (e) => console.log(`[${tag} pageerror]`, String(e).slice(0, 300)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(4000);
  await page.mouse.click(160, 90);
  await sleep(300);
  const cdp = await context.newCDPSession(page);
  await fn(page, cdp);
  await page.close();
  await context.close();
}

// Session A: tumbas — frente a 8,5 m, depois close-up a ~6 m.
await zone(`${BASE}/?class=espadachim&gender=f&name=NEF&dungeon=tumbas&testmobs=neferet`, async (p, cdp) => {
  const s = await waitNeferetGlb(p, "tumbas");
  console.log("tumbas neferet state:", JSON.stringify(s));
  await capShot(p, cdp, "neferet_glb_tumbas_front_85m");
  for (let i = 0; i < 6; i += 1) { await p.mouse.wheel(0, -240); await sleep(300); }
  console.log("tumbas zoom now:", JSON.stringify(await neferetState(p)));
  await capShot(p, cdp, "neferet_glb_tumbas_front_close");
}, "tumbas");

// Session B: cidade — frente clara a 8,5 m + close-up.
await zone(`${BASE}/?class=espadachim&gender=f&name=NEF&testmobs=neferet`, async (p, cdp) => {
  const s = await waitNeferetGlb(p, "city");
  console.log("city neferet state:", JSON.stringify(s));
  await capShot(p, cdp, "neferet_glb_city_front_85m");
  for (let i = 0; i < 6; i += 1) { await p.mouse.wheel(0, -240); await sleep(300); }
  await capShot(p, cdp, "neferet_glb_city_front_close");
}, "city");

// Session C: lado (testmobry=1.57).
await zone(`${BASE}/?class=espadachim&gender=f&name=NEF&testmobs=neferet&testmobry=1.57`, async (p, cdp) => {
  console.log("side state:", JSON.stringify(await waitNeferetGlb(p, "side")));
  await capShot(p, cdp, "neferet_glb_city_side");
}, "side");

// Session D: costas (testmobry=3.14).
await zone(`${BASE}/?class=espadachim&gender=f&name=NEF&testmobs=neferet&testmobry=3.14`, async (p, cdp) => {
  console.log("back state:", JSON.stringify(await waitNeferetGlb(p, "back")));
  await capShot(p, cdp, "neferet_glb_city_back");
}, "back");

await browser.close();
console.log("done");
