// Probe: report camera + player positions in the city, then walk north.
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
const sha = "8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6";

const browser = await chromium.launch({
  executablePath: "/opt/meta-chromium/chrome",
  ignoreDefaultArgs: ["--disable-features"],
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--window-size=1280,720",
    "--no-proxy-server",
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests",
    "--local-network-access-allowed-for-urls=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001,ws://localhost:3001,ws://127.0.0.1:3001",
    "--hatch-webgl-allowed-domains-file=/home/hatch/workspace/azure-edge/work/verify/webgl-allowed-domains.txt",
    `--hatch-webgl-allowed-domains-sha256=${sha}`,
  ],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") { await route.abort(); return; }
  let rel = decodeURIComponent(u.pathname);
  if (rel === "/") rel = "/index.html";
  try { await route.fulfill({ body: await readFile(`${DIST}${rel}`), contentType: mime(rel) }); }
  catch { await route.fulfill({ body: "not found", status: 404 }); }
});

const report = async (tag) => {
  const r = await page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    const cam = v.camera?.position ?? v.camPos;
    const players = [...v.players.entries()].map(([id, e]) => {
      const p = e.group.position;
      return { id, x: +p.x.toFixed(1), z: +p.z.toFixed(1), local: id === v.localId };
    });
    // Closest scene objects to the camera (what could be blocking the view?).
    let near = null;
    try {
      const list = [];
      v.scene.traverse((o) => {
        if (!o.isMesh) return;
        const wp = new o.position.constructor();
        o.getWorldPosition(wp);
        const d = Math.hypot(wp.x - cam.x, wp.y - cam.y, wp.z - cam.z);
        if (d < 12) {
          list.push({
            d: +d.toFixed(1),
            pos: [wp.x, wp.y, wp.z].map((n) => +n.toFixed(1)),
            name: o.name || o.type,
            mat: o.material?.color ? `#${o.material.color.getHexString()}` : "?",
            key: o.userData?.sceneryKey ?? o.parent?.userData?.sceneryKey ?? "?",
          });
        }
      });
      list.sort((a, b) => a.d - b.d);
      near = list.slice(0, 8);
    } catch (e) { near = `traverse error: ${String(e).slice(0, 80)}`; }
    return {
      cam: cam ? { x: +cam.x.toFixed(1), y: +cam.y.toFixed(1), z: +cam.z.toFixed(1) } : null,
      players,
      zoom: v.zoom25DValue,
      near,
    };
  });
  console.log(tag, JSON.stringify(r));
};

await page.goto("http://localhost:5173/?class=espadachim&gender=f&name=Probe", { waitUntil: "networkidle", timeout: 60000 });
await sleep(12000);
await report("spawn");
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.down("KeyW");
await sleep(2000);
await page.keyboard.up("KeyW");
await sleep(1000);
await report("after W 2s");
const cdp = await context.newCDPSession(page);
const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
await writeFile(`${OUT}110_probe_afterW.png`, Buffer.from(data, "base64"));
console.log("shot saved");
await browser.close();
