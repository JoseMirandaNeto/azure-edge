// Visual verification for round 3 (scenery): city / dunes / tumbas.
// Usage: node verify.mjs  (client dist/ served via route interception;
// server-game on :3001 is NOT reachable from the browser — the scene
// still renders, only the WS stays down, which is fine for scenery.)
import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";

const OUT = new URL("../../docs/visual-verify/", import.meta.url).pathname;
const DIST = new URL("../../apps/client/dist/", import.meta.url).pathname;
const BASE = "http://localhost:5173";

function mime(p) {
  if (p.endsWith(".html")) return "text/html";
  if (p.endsWith(".js")) return "text/javascript";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".glb")) return "model/gltf-binary";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, cdp, name) {
  // Walk at 320x180 (rAF ~2.8 fps with ?char=capsule; inputs are sent
  // from the rAF loop, so a 1280x720 page walks at ~0.05 m/s). Resize to
  // 1280x720 for the shot itself, wait for a full-size frame, capture,
  // then shrink back for the next walk.
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(4000);
  // CDP captureScreenshot: page.screenshot() hangs on "waiting for fonts"
  // in this headless build; CDP does not wait for fonts.
  let data = null;
  for (let attempt = 0; attempt < 3 && !data; attempt += 1) {
    try {
      ({ data } = await cdp.send("Page.captureScreenshot", { format: "png" }));
    } catch (e) {
      console.log(`shot ${name} attempt ${attempt} failed:`, String(e).slice(0, 120));
      await sleep(3000);
    }
  }
  await page.setViewportSize({ width: 320, height: 180 });
  if (!data) throw new Error(`screenshot failed 3x: ${name}`);
  await writeFile(`${OUT}${name}.png`, Buffer.from(data, "base64"));
  const info = await page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    const r = v.renderer.info.render;
    let pos = null;
    for (const [id, e] of v.players) {
      if (id === v.localId) pos = { x: +e.group.position.x.toFixed(1), z: +e.group.position.z.toFixed(1) };
    }
    return { backend: v.backend, calls: r.calls ?? r.drawCalls, tris: r.triangles, pos };
  });
  console.log(name, JSON.stringify(info));
  return info;
}

async function walk(page, key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
  await sleep(700);
}

/** Diagonal walk: hold two keys at once. */
async function walk2(page, k1, k2, ms) {
  await page.keyboard.down(k1);
  await page.keyboard.down(k2);
  await sleep(ms);
  await page.keyboard.up(k1);
  await page.keyboard.up(k2);
  await sleep(700);
}

async function playerPos(page) {
  return page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    for (const [id, e] of v.players) {
      if (id === v.localId) return { x: e.group.position.x, z: e.group.position.z };
    }
    return null;
  });
}

/**
 * Walk to an absolute (x, z) target from wherever the server actually
 * spawned the player (the server scatters spawns on a golden-angle ring
 * around the zone spawn, radius growing with the player id — so the
 * origin is never (0,0) once bots have joined). W = north (-Z).
 * Retries with a perpendicular sidestep when the player is stuck on a
 * collider (e.g. spawned inside the temple); gives up after budgetMs.
 */
async function goto(page, tx, tz, tag, budgetMs = 45000) {
  const t0 = Date.now();
  let last = await playerPos(page);
  if (!last) { console.log(tag, "no local player (disconnected?)"); return; }
  let stuck = 0;
  while (Date.now() - t0 < budgetMs) {
    const p = (await playerPos(page)) ?? last;
    const dx = tx - p.x;
    const dz = tz - p.z;
    if (Math.hypot(dx, dz) < 1.2) break;
    const leg = (key, ms) => walk(page, key, Math.min(ms, 3500));
    // Effective walk speed under swiftshader at 320x180 + capsule is
    // ~0.8 m/s (inputs ride the rAF loop at ~2.8 fps); size legs by it.
    if (Math.abs(dz) > 0.7) await leg(dz < 0 ? "KeyW" : "KeyS", (Math.abs(dz) / 0.8) * 1000);
    else if (Math.abs(dx) > 0.7) await leg(dx > 0 ? "KeyD" : "KeyA", (Math.abs(dx) / 0.8) * 1000);
    const p2 = (await playerPos(page)) ?? p;
    if (Math.hypot(p2.x - p.x, p2.z - p.z) < 0.4) {
      stuck += 1;
      await walk(page, stuck % 2 ? "KeyD" : "KeyA", 1500); // sidestep out of the collider
    } else stuck = 0;
    last = p2;
  }
  console.log(tag, "at", JSON.stringify(await playerPos(page)));
}

const browser = await chromium.launch({
  executablePath: "/opt/meta-chromium/chrome",
  ignoreDefaultArgs: ["--disable-features"],
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--window-size=1280,720",
    "--no-proxy-server",
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests",
    "--local-network-access-allowed-for-urls=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001,ws://localhost:3001,ws://127.0.0.1:3001",
    "--hatch-webgl-allowed-domains-file=/home/hatch/workspace/azure-edge/work/verify/webgl-allowed-domains.txt",
    "--hatch-webgl-allowed-domains-sha256=8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6",
  ],
});

async function zone(url, shots) {
  // 320x180 + ?char=capsule for walking (see shot()): the GLB warrior's
  // 256-bone skinning costs ~65% of the frame under swiftshader.
  const context = await browser.newContext({ viewport: { width: 320, height: 180 } });
  const page = await context.newPage();
  // Serve the built client from disk via route interception: the browser
  // never makes a real request to localhost, so Chromium 157's Local
  // Network Access checks never fire. (Direct navigation to 127.0.0.1 is
  // blocked in this Hatch Chromium build even with the allowlist flags.)
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
      await route.abort();
      return;
    }
    let rel = decodeURIComponent(u.pathname);
    if (rel === "/") rel = "/index.html";
    const file = `${DIST}${rel}`;
    try {
      const data = await readFile(file);
      await route.fulfill({ body: data, contentType: mime(rel), status: 200 });
    } catch {
      await route.fulfill({ body: "not found", status: 404 });
    }
  });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.type(), m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  page.on("crash", () => console.log("[crash] page crashed")); 
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await sleep(12000); // GLBs (chars + scenery) load in background
  const ae = await page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    return {
      backend: v.backend,
      focus: document.activeElement?.tagName ?? "?",
      sceneryTemplates: [...v.sceneryTemplates.keys()],
      placeholdersLeft: v.sceneryPlaceholders.length,
    };
  });
  console.log("loaded", url.split("?")[1] ?? "", JSON.stringify(ae));
  // Click the canvas so keyboard input reaches the game. (Blur alone
  // breaks keys in headless Chrome: keydown/up go nowhere without focus.)
  // Viewport is 320x180 while walking: click its center.
  await page.mouse.click(160, 90);
  await sleep(300);
  const cdp = await context.newCDPSession(page);
  for (const [name, act] of shots) {
    if (act) await act(page);
    await shot(page, cdp, name);
  }
  await page.close();
  await context.close();
}

// City tour: house front (10,-17.3) -> fountain (7,-7) -> east stall
// (12,12) -> west stall (-12,12); each framed from the south.
// ?char=capsule: the capsule walks at ~0.8 m/s where the GLB warrior
// walks at ~0.05 m/s under swiftshader (inputs ride the rAF loop).
await zone(`${BASE}/?class=espadachim&gender=f&name=Verif&char=capsule`, [
  ["110_city_spawn", null],
  ["110_city_house", async (p) => { await goto(p, 10, -8, "house", 60000); }],
  ["110_city_fountain", async (p) => { await goto(p, 7, 2, "fountain", 60000); }],
  ["110_city_stall_e", async (p) => { await goto(p, 12, 20, "stall_e", 60000); }],
  ["110_city_stall_w", async (p) => { await goto(p, -12, 20, "stall_w", 60000); }],
]);
// Tumbas: altar (north end of the hall). Dungeon verified in earlier runs;
// this re-shoots the altar close-up with the capsule-walk technique.
await zone(`${BASE}/?class=espadachim&gender=f&name=Verif&char=capsule&dungeon=tumbas`, [
  ["112_tumbas_spawn", null],
  ["112_tumbas_altar", async (p) => { await goto(p, 0, -12, "altar", 60000); }],
]);

await browser.close();
console.log("done");
