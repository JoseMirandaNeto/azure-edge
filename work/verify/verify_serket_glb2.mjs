// Serket GLB round 2: rings fixed (unscaled wrapper, gamedata-scale rings).
// Temple: fast front shot at 8.5 m before the real boss reaches the player.
// City (no hostiles, bright): front / close-up / 3D-orbit side + back.
// Usage: node verify_serket_glb2.mjs  (server-game on :3001 required)
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
      // Ring radii actually on screen (world units, incl. all ancestors).
      const rings = [];
      group.traverse((o) => {
        if (o.isMesh && o.geometry?.type === "RingGeometry") {
          let s = 1;
          let n = o;
          while (n) { s *= n.scale.x; n = n.parent; }
          rings.push(+((o.geometry.parameters.outerRadius ?? 0) * s).toFixed(2));
        }
      });
      return {
        glb: !!group.userData.serketGlb, meshes, tris,
        scale: +group.scale.x.toFixed(2),
        pos: [+group.position.x.toFixed(1), +group.position.y.toFixed(2), +group.position.z.toFixed(1)],
        rotY: +group.rotation.y.toFixed(2), rings,
      };
    };
    const real = [];
    for (const e of v.mobs.values()) real.push({ mobId: e.mobId, glb: !!e.glb, ...describe(e.group) });
    const test = v.testMobs.map((e) => ({ mobId: e.mobId, glb: !!e.glb, ...describe(e.group) }));
    const dead = document.body.innerText.includes("Você caiu");
    return { backend: v.backend, zoom: +v.zoom25DValue.toFixed(1), dead, real, test };
  });
}

async function waitSerketGlb(page, tag, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await serketState(page);
    if (s && s.test.some((t) => t.mobId === "serket" && t.glb)) return s;
    await sleep(700);
  }
  return serketState(page);
}

/** Click "Ressuscitar agora" if the death modal is up. */
async function respawnIfDead(page) {
  const s = await serketState(page);
  if (s?.dead) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await sleep(300);
    await page.mouse.click(640, 437);
    await sleep(2500);
    console.log("respawned");
  }
  return s;
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
  await page.mouse.click(160, 90); // dismiss start screen
  await sleep(300);
  const cdp = await context.newCDPSession(page);
  await fn(page, cdp);
  await page.close();
  await context.close();
}

// Session A: temple 2.5D — front at 8.5 m ASAP, then close-up at 6 m.
await zone(`${BASE}/?class=espadachim&gender=f&name=SERK&dungeon=templo&testmobs=serket`, async (p, cdp) => {
  const s = await waitSerketGlb(p, "temple");
  console.log("temple serket state:", JSON.stringify(s));
  await capShot(p, cdp, "serket_glb2_temple_front_85m");
  await respawnIfDead(p);
  for (let i = 0; i < 6; i += 1) { await p.mouse.wheel(0, -240); await sleep(300); }
  console.log("temple zoom now:", JSON.stringify(await serketState(p)));
  await capShot(p, cdp, "serket_glb2_temple_front_close");
}, "temple");

// Session B: city 2.5D — bright front + close-up (no hostiles).
await zone(`${BASE}/?class=espadachim&gender=f&name=SERK&testmobs=serket`, async (p, cdp) => {
  const s = await waitSerketGlb(p, "city");
  console.log("city serket state:", JSON.stringify(s));
  await capShot(p, cdp, "serket_glb2_city_front_85m");
  for (let i = 0; i < 6; i += 1) { await p.mouse.wheel(0, -240); await sleep(300); }
  await capShot(p, cdp, "serket_glb2_city_front_close");
}, "city");

// Session C: city 3D orbit — side (~90 deg) + back (~180 deg).
await zone(`${BASE}/?class=espadachim&gender=f&name=SERK&camera=3d&testmobs=serket`, async (p, cdp) => {
  const s = await waitSerketGlb(p, "city3d");
  console.log("city3d serket state:", JSON.stringify(s));
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
  await drag(320);
  await capShot(p, cdp, "serket_glb2_city_side");
  await drag(320);
  await capShot(p, cdp, "serket_glb2_city_back");
}, "city3d");

await browser.close();
console.log("done");
