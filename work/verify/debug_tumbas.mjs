// Debug one-off: load the tumbas dungeon and report what the page shows.
import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";

const DIST = "/home/hatch/workspace/azure-edge/apps/client/dist";
const OUT = "/home/hatch/workspace/azure-edge/docs/visual-verify/";
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

const domains = await readFile(
  "/home/hatch/workspace/azure-edge/work/verify/webgl-allowed-domains.txt", "utf8");
const sha = "8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6";

const browser = await chromium.launch({
  executablePath: "/opt/meta-chromium/chrome",
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    `--hatch-webgl-allowed-domains-file=/home/hatch/workspace/azure-edge/work/verify/webgl-allowed-domains.txt`,
    `--hatch-webgl-allowed-domains-sha256=${sha}`,
  ],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.type(), m.text().slice(0, 200)); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("crash", () => console.log("[crash] page crashed"));
page.on("framenavigated", (f) => console.log("[nav]", f.url()));

await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (u.protocol === "ws:" || u.protocol === "wss:") { await route.abort(); return; }
  if (u.hostname === "localhost" && u.port === "3001") { await route.abort(); return; }
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
    const p = `${DIST}${u.pathname === "/" ? "/index.html" : u.pathname}`;
    try { await route.fulfill({ body: await readFile(p), contentType: mime(p) }); }
    catch { await route.abort(); }
    return;
  }
  await route.abort();
});

const url = "http://localhost:5173/?class=espadachim&gender=f&name=Verif&dungeon=tumbas";
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await sleep(12000);
console.log("url:", page.url());
console.log("focus:", await page.evaluate(() => document.activeElement?.tagName + "#" + (document.activeElement?.id ?? "") + " " + (document.activeElement?.textContent ?? "").slice(0, 60)));
console.log("body text:", (await page.evaluate(() => document.body.innerText)).slice(0, 500).replace(/\n/g, " | "));
console.log("aeView:", await page.evaluate(() => {
  const v = window.__aeView;
  if (!v) return null;
  return { backend: v.backend, templates: [...v.sceneryTemplates.keys()], placeholders: v.sceneryPlaceholders.length };
}));
const cdp = await context.newCDPSession(page);
try {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT}112_tumbas_debug.png`, Buffer.from(data, "base64"));
  console.log("screenshot ok");
} catch (e) {
  console.log("screenshot FAILED:", String(e).slice(0, 200));
}
await browser.close();
