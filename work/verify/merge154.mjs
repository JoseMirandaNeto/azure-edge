// Male attack retry (154_): walk south 4 s out of the fountain first, then
// attack in open plaza. The 153 shot had the warrior hidden behind the
// fountain column.
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
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(`${BASE}/?class=espadachim&gender=m&name=M154`, { waitUntil: "networkidle", timeout: 60000 });
await sleep(12000);
console.log("loaded", await page.evaluate(() => {
  const v = window.__aeView;
  return v ? { backend: v.backend, players: v.players.size } : null;
}));
await page.mouse.click(160, 90);
await sleep(300);
// Walk south 4 s into open plaza, then attack.
await page.keyboard.down("KeyS");
await sleep(4000);
await page.keyboard.up("KeyS");
await sleep(500);
const cdp = await context.newCDPSession(page);
await page.setViewportSize({ width: 1280, height: 720 });
await sleep(1500);
await page.mouse.click(640, 360);
await sleep(400);
let data = null;
try { ({ data } = await cdp.send("Page.captureScreenshot", { format: "png" })); } catch {}
if (data) await writeFile(`${OUT}154_male_attack.png`, Buffer.from(data, "base64"));
console.log("154_male_attack captured");
await browser.close();
console.log("done");
