// Measure rAF rate in the city page (inputs are sent from the rAF loop).
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
await page.goto("http://localhost:5173/?class=espadachim&gender=f&name=Fps", { waitUntil: "networkidle", timeout: 60000 });
await sleep(12000);
const fps = await page.evaluate(() => new Promise((resolve) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => { n += 1; if (performance.now() - t0 < 10000) requestAnimationFrame(tick); else resolve((n / 10).toFixed(2)); };
  requestAnimationFrame(tick);
}));
console.log("rAF fps over 10s:", fps);
await browser.close();
