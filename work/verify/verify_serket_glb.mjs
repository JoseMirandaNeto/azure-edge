// Serket GLB boss verification: front @12m / 8.5m / close-up (2.5D),
// side + back via 3D orbit drag. Client dist/ served via route
// interception; server-game must be running on :3001 (testmobs need WS).
// Usage: node verify_serket_glb.mjs
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

/** Inspect live serket entries: real mobs + test mobs, GLB swap state. */
async function serketState(page) {
  return page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    const describe = (group) => {
      let meshes = 0;
      let tris = 0;
      group.traverse((o) => {
        if (o.isMesh) {
          meshes += 1;
          const g = o.geometry;
          tris += Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
        }
      });
      return {
        glb: !!group.userData.serketGlb,
        meshes,
        tris,
        scale: +group.scale.x.toFixed(2),
        pos: [+group.position.x.toFixed(1), +group.position.y.toFixed(2), +group.position.z.toFixed(1)],
        rotY: +group.rotation.y.toFixed(2),
      };
    };
    const real = [];
    for (const e of v.mobs.values()) real.push({ mobId: e.mobId, glb: !!e.glb, ...describe(e.group) });
    const test = v.testMobs.map((e) => ({ mobId: e.mobId, glb: !!e.glb, ...describe(e.group) }));
    return { backend: v.backend, zoom: +v.zoom25DValue.toFixed(1), real, test };
  });
}

async function waitSerketGlb(page, tag, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await serketState(page);
    if (s && s.test.some((t) => t.mobId === "serket" && t.glb)) return s;
    await sleep(1000);
  }
  return serketState(page);
}

async function capShot(page, cdp, name) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(3500);
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
  page.on("console", (m) => {
    const t = m.text();
    if (/serket|GLB/i.test(t)) console.log(`[${tag} console]`, t.slice(0, 200));
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await sleep(12000);
  console.log(`loaded ${tag}`, JSON.stringify(await serketState(page)));
  await page.mouse.click(160, 90);
  await sleep(300);
  const cdp = await context.newCDPSession(page);
  await fn(page, cdp);
  await page.close();
  await context.close();
}

// Session A: 2.5D — front views at 12 m (default), ~8.5 m, close-up ~6 m.
await zone(`${BASE}/?class=espadachim&gender=f&name=SERK&dungeon=templo&testmobs=serket`, async (p, cdp) => {
  const s = await waitSerketGlb(p, "2.5d");
  console.log("serket state after wait:", JSON.stringify(s));
  await capShot(p, cdp, "serket_glb_front_12m");
  // Wheel in: zoom toward ~8.5 m, then ~6 m (read the real value back).
  for (let i = 0; i < 6; i += 1) { await p.mouse.wheel(0, -240); await sleep(300); }
  console.log("zoom after wheel-in:", JSON.stringify(await serketState(p)));
  await capShot(p, cdp, "serket_glb_front_85m");
  for (let i = 0; i < 6; i += 1) { await p.mouse.wheel(0, -240); await sleep(300); }
  console.log("zoom after wheel-in 2:", JSON.stringify(await serketState(p)));
  await capShot(p, cdp, "serket_glb_front_close");
}, "serket-25d");

// Session B: 3D orbit — drag to see the side (~90 deg) and back (~180 deg).
await zone(`${BASE}/?class=espadachim&gender=f&name=SERK&camera=3d&dungeon=templo&testmobs=serket`, async (p, cdp) => {
  const s = await waitSerketGlb(p, "3d");
  console.log("serket state after wait:", JSON.stringify(s));
  await p.setViewportSize({ width: 1280, height: 720 });
  await sleep(1000);
  async function drag(dx) {
    await p.mouse.move(640, 360);
    await p.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await p.mouse.move(640 + (dx * i) / 10, 360, { steps: 2 });
      await sleep(60);
    }
    await p.mouse.up();
    await sleep(1200);
  }
  await drag(320); // ~90 deg orbit -> side view
  await capShot(p, cdp, "serket_glb_side");
  await drag(320); // ~180 deg total -> back view
  await capShot(p, cdp, "serket_glb_back");
}, "serket-3d");

await browser.close();
console.log("done");
