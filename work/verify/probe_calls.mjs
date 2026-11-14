// Is renderer.info.render.calls per-frame or cumulative? Read it 3x.
import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
const DIST = "/home/hatch/workspace/azure-edge/apps/client/dist";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mime = (p) =>
  p.endsWith(".html") ? "text/html" : p.endsWith(".js") ? "text/javascript" :
  p.endsWith(".css") ? "text/css" : p.endsWith(".png") ? "image/png" :
  p.endsWith(".glb") ? "model/gltf-binary" : p.endsWith(".json") ? "application/json" :
  p.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
const sha = "8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6";
const browser = await chromium.launch({
  executablePath: "/opt/meta-chromium/chrome",
  ignoreDefaultArgs: ["--disable-features"],
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--window-size=1280,720", "--no-proxy-server",
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests",
    "--local-network-access-allowed-for-urls=http://localhost:5173,http://localhost:3001,ws://localhost:3001",
    "--hatch-webgl-allowed-domains-file=/home/hatch/workspace/azure-edge/work/verify/webgl-allowed-domains.txt",
    `--hatch-webgl-allowed-domains-sha256=${sha}`],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") { await route.abort(); return; }
  let rel = decodeURIComponent(u.pathname);
  if (rel === "/") rel = "/index.html";
  try { await route.fulfill({ body: await readFile(`${DIST}${rel}`), contentType: mime(rel) }); }
  catch { await route.fulfill({ body: "not found", status: 404 }); }
});
await page.goto("http://localhost:5173/?class=espadachim&gender=f&name=Calls", { waitUntil: "networkidle", timeout: 60000 });
await sleep(12000);
for (let i = 0; i < 4; i += 1) {
  const info = await page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    const r = v.renderer.info.render;
    return { calls: r.calls, tris: r.triangles, autoReset: v.renderer.info.autoReset };
  });
  console.log(`t+${i * 3}s`, JSON.stringify(info));
  await sleep(3000);
}
await browser.close();
