// Serket GLB round 3: side + back via ?testmobry= in the city (2.5D fixed
// camera, test mob rotated instead of orbiting). Usage:
// node verify_serket_glb3.mjs  (server-game on :3001 required)
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

async function serketState(page) {
  return page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    const test = v.testMobs.map((e) => ({
      mobId: e.mobId, glb: !!e.glb,
      rotY: +e.group.rotation.y.toFixed(2),
      pos: [+e.group.position.x.toFixed(1), +e.group.position.z.toFixed(1)],
    }));
    return { backend: v.backend, zoom: +v.zoom25DValue.toFixed(1), test };
  });
}

async function waitSerketGlb(page, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await serketState(page);
    if (s && s.test.some((t) => t.mobId === "serket" && t.glb)) return s;
    await sleep(700);
  }
  return serketState(page);
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

// Side: testmobry=1.57 turns the mob 90 deg (profile to the fixed camera).
await zone(`${BASE}/?class=espadachim&gender=f&name=SERK&testmobs=serket&testmobry=1.57`, async (p, cdp) => {
  console.log("side state:", JSON.stringify(await waitSerketGlb(p)));
  await capShot(p, cdp, "serket_glb3_city_side");
}, "side");

// Back: testmobry=3.14 turns the mob around (back to the fixed camera).
await zone(`${BASE}/?class=espadachim&gender=f&name=SERK&testmobs=serket&testmobry=3.14`, async (p, cdp) => {
  console.log("back state:", JSON.stringify(await waitSerketGlb(p)));
  await capShot(p, cdp, "serket_glb3_city_back");
}, "back");

await browser.close();
console.log("done");
