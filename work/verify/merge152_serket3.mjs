// Serket iteration 2 re-shoot (152_): dark scorpion body, overlapping tail,
// bigger claw blades. City close-up (no hostile mobs) + dunas wide from
// spawn (no approach walk — the capsule dies to live scorpions on the way).
// Templo: one approach attempt; if the player dies inside the mob, the shot
// is recorded as blocked by the known server spawn bug.
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

async function shot(page, cdp, name) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(3500);
  let data = null;
  for (let attempt = 0; attempt < 3 && !data; attempt += 1) {
    try { ({ data } = await cdp.send("Page.captureScreenshot", { format: "png" })); }
    catch (e) { console.log(`shot ${name} attempt ${attempt} failed:`, String(e).slice(0, 120)); await sleep(3000); }
  }
  await page.setViewportSize({ width: 320, height: 180 });
  if (!data) throw new Error(`screenshot failed 3x: ${name}`);
  await writeFile(`${OUT}${name}.png`, Buffer.from(data, "base64"));
  const info = await page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    const r = v.renderer.info.render;
    return { backend: v.backend, calls: r.calls ?? r.drawCalls, tris: r.triangles };
  });
  console.log(name, JSON.stringify(info));
}

async function walk(page, key, ms) {
  await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); await sleep(700);
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
async function goto(page, tx, tz, tag, budgetMs = 45000) {
  const t0 = Date.now();
  let last = await playerPos(page);
  if (!last) { console.log(tag, "no local player"); return; }
  let stuck = 0;
  while (Date.now() - t0 < budgetMs) {
    const p = (await playerPos(page)) ?? last;
    const dx = tx - p.x, dz = tz - p.z;
    if (Math.hypot(dx, dz) < 1.2) break;
    const leg = (key, ms) => walk(page, key, Math.min(ms, 3500));
    if (Math.abs(dz) > 0.7) await leg(dz < 0 ? "KeyW" : "KeyS", (Math.abs(dz) / 0.8) * 1000);
    else if (Math.abs(dx) > 0.7) await leg(dx > 0 ? "KeyD" : "KeyA", (Math.abs(dx) / 0.8) * 1000);
    const p2 = (await playerPos(page)) ?? p;
    if (Math.hypot(p2.x - p.x, p2.z - p.z) < 0.4) { stuck += 1; await walk(page, stuck % 2 ? "KeyD" : "KeyA", 1500); }
    else stuck = 0;
    last = p2;
  }
  console.log(tag, "at", JSON.stringify(await playerPos(page)));
}

async function zone(url, shots, tag) {
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
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await sleep(12000);
  console.log(`loaded ${tag}`, await page.evaluate(() => {
    const v = window.__aeView;
    return v ? { backend: v.backend, players: v.players.size } : null;
  }));
  await page.mouse.click(160, 90);
  await sleep(300);
  const cdp = await context.newCDPSession(page);
  for (const [name, act] of shots) {
    if (act) await act(page, cdp); else await shot(page, cdp, name);
  }
  await page.close();
  await context.close();
}

await zone(`${BASE}/?class=espadachim&gender=f&name=S2C&testmobs=serket&char=capsule`, [
  ["152_serket_city", async (p, cdp) => {
    const s = await p.evaluate(() => {
      const v = window.__aeView;
      const t = v.testMobs[0];
      return t ? { x: +t.group.position.x.toFixed(1), z: +t.group.position.z.toFixed(1) } : null;
    });
    console.log("city serket at", JSON.stringify(s));
    if (s) await goto(p, s.x, s.z + 4.5, "approach serket city", 60000);
    await shot(p, cdp, "152_serket_city");
  }],
], "city2");

await zone(`${BASE}/?class=espadachim&gender=f&name=S2D&zone=dunas_serket&testmobs=serket&char=capsule`, [
  ["152_serket_dunas", null],
], "dunas2");

await zone(`${BASE}/?class=espadachim&gender=f&name=S2T&dungeon=templo&testmobs=serket&char=capsule`, [
  ["152_serket_templo", async (p, cdp) => {
    const s = await p.evaluate(() => {
      const v = window.__aeView;
      const t = v.testMobs[0];
      return t ? { x: +t.group.position.x.toFixed(1), z: +t.group.position.z.toFixed(1) } : null;
    });
    console.log("templo serket at", JSON.stringify(s));
    if (s) await goto(p, s.x, s.z + 4.5, "approach serket templo", 60000);
    await shot(p, cdp, "152_serket_templo");
  }],
], "templo2");

await browser.close();
console.log("done");
