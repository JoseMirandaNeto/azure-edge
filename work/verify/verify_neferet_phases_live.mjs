// Neferet 3-phase fight, LIVE: real tumbas fight with dev-only playtest
// hooks (AZURE_EDGE_TEST_ATK_MULT=50 + AZURE_EDGE_TEST_HP_MULT=100,
// server local :3001, NODE_ENV != production) so a lv 1 tester can deal
// the ~26k damage needed to reach phase 2 and survive the walk there.
// Attack range is 2.5 m (basic chain arc) — the probe only swings at
// dist <= 2.2 m, re-facing between swings; swinging at 3.5 m whiffs
// (first attempt: 85 swings, 0 damage, 82 deaths). The client renders
// at ~0.8 fps under SwiftShader, so a re-face hold must last >= 1.5 s
// (a 200 ms hold spans zero frames and never sends an input) and each
// swing is a single click — the lunge carries the player past the boss.
// from the REAL server snapshot + client visuals (no injected fakes):
//  - 75%/50%: summon volleys (mummy count +2 each)
//  - <50%: sand rain — server aoes[] non-empty AND the ground decal visible
//  - <25%: enrage — server enraged=true AND the red ring visible
//  - boss hp 0: fight ends
// Uso: AZURE_EDGE_TEST_ATK_MULT=50 AZURE_EDGE_TEST_HP_MULT=100 node apps/server-game/dist/index.js &
//      node work/verify/verify_neferet_phases_live.mjs
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

const errors = [];
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") { await route.abort(); return; }
  let rel = decodeURIComponent(u.pathname);
  if (rel === "/") rel = "/index.html";
  try { await route.fulfill({ body: await readFile(`${DIST}${rel}`), contentType: mime(rel), status: 200 }); }
  catch { await route.fulfill({ body: "not found", status: 404 }); }
});
page.on("pageerror", (e) => { console.log("[pageerror]", String(e).slice(0, 300)); errors.push(String(e).slice(0, 200)); });
await page.goto(`${BASE}/?class=espadachim&gender=f&name=NEF&dungeon=tumbas`, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(4000);
await page.mouse.click(640, 360);
await sleep(300);

// Intercept updateMob: record the latest REAL server snapshot for Neferet
// (hpPct/enraged/aoes) — the view entry itself keeps no hpPct.
await page.evaluate(() => {
  const v = window.__aeView;
  if (!v || v.__nefHooked) return;
  const orig = v.updateMob.bind(v);
  window.__nef = null;
  v.__nefHooked = true;
  v.updateMob = (e, tick) => {
    if (e.mobId === "neferet") {
      window.__nef = { hpPct: e.hpPct, enraged: e.enraged, aoes: (e.aoes ?? []).length, x: e.x, y: e.y };
    }
    return orig(e, tick);
  };
});

async function capShot(cdp, name) {
  await sleep(1200);
  let data = null;
  for (let a = 0; a < 3 && !data; a += 1) {
    try { ({ data } = await cdp.send("Page.captureScreenshot", { format: "png" })); }
    catch { await sleep(3000); }
  }
  if (!data) throw new Error(`shot failed: ${name}`);
  await writeFile(`${OUT}${name}.png`, Buffer.from(data, "base64"));
  console.log(name, "captured");
}
async function debugText() {
  return page.evaluate(() => document.getElementById("debug")?.textContent ?? "");
}
function parsePos(t) {
  const m = t.match(/pos: (-?[\d.]+), (-?[\d.]+)/);
  return m ? [+m[1], +m[2]] : null;
}
function parseHp(t) {
  const m = t.match(/hp: (\d+)%/);
  return m ? +m[1] : null;
}
function parseDiag(t) {
  const corr = t.match(/corr: ([\d.]+)/);
  const estado = t.match(/estado: (\w+)/);
  const rejects = t.match(/rejects: (\d+)/);
  const alvo = t.match(/alvo: (.+)/);
  const fps = t.match(/fps: ([\d.]+)/);
  return {
    corr: corr ? +corr[1] : null,
    estado: estado ? estado[1] : null,
    rejects: rejects ? +rejects[1] : null,
    alvo: alvo ? alvo[1] : null,
    fps: fps ? +fps[1] : null,
  };
}
async function nefState() {
  return page.evaluate(() => {
    const v = window.__aeView;
    const snap = window.__nef;
    if (!v || !snap) return null;
    let entry = null;
    for (const e of v.mobs.values()) if (e.mobId === "neferet") entry = e;
    const mummies = [...v.mobs.values()].filter((e) => e.mobId === "mumia").length;
    return {
      ...snap,
      decalVisible: entry?.aoes?.some((a) => a.visible) ?? false,
      enrageVisible: entry?.enrage?.visible ?? false,
      glb: entry?.glb ?? false,
      mummies,
    };
  });
}

const cdp = await context.newCDPSession(page);
// Wait for the first real snapshot with Neferet in it.
let st = null;
for (let i = 0; i < 30; i += 1) {
  st = await nefState();
  if (st) break;
  await sleep(1000);
}
if (!st) throw new Error("neferet never appeared in snapshots");
console.log("boss initial:", JSON.stringify(st));
const mummies0 = st.mummies;

// Closed-loop steering: S = -y (boss is south), W = +y, A/D = -x/+x.
const keyFor = (dx, dy) => (Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "KeyS" : "KeyW") : (dx < 0 ? "KeyA" : "KeyD"));
let held = null;
const hold = async (key) => {
  if (held === key) return;
  if (held) await page.keyboard.up(held);
  if (key) await page.keyboard.down(key);
  held = key;
};

const seen = { s75: false, s50: false, rain: false, enrage: false, dead: false };
const t0 = Date.now();
let swings = 0;
let deaths = 0;
let lastLog = 0;
while (Date.now() - t0 < 600000) {
  st = await nefState();
  const dbg = await debugText();
  const pos = parsePos(dbg);
  const hp = parseHp(dbg);
  if (!st || !pos) { await sleep(500); continue; }
  if (st.hpPct <= 0) { seen.dead = true; console.log("boss DOWN, hpPct 0"); break; }
  // Phase checkpoints (server truth + client visuals).
  if (!seen.s75 && st.hpPct <= 75) {
    seen.s75 = true;
    console.log(`75% crossed: hp ${st.hpPct}% mummies ${mummies0} -> ${st.mummies}`);
    await capShot(cdp, "neferet_live_p1_summons");
  }
  if (!seen.s50 && st.hpPct <= 50) {
    seen.s50 = true;
    console.log(`50% crossed: hp ${st.hpPct}% mummies ${st.mummies} enraged=${st.enraged} aoes=${st.aoes}`);
  }
  if (!seen.rain && st.aoes > 0) {
    seen.rain = true;
    console.log(`RAIN live: hp ${st.hpPct}% server aoes=${st.aoes} decalVisible=${st.decalVisible}`);
    await capShot(cdp, "neferet_live_p2_rain");
  }
  if (!seen.enrage && st.hpPct <= 25) {
    // Wait a tick for the client to show the ring, then capture fast:
    // poise damage can break the enrage ~10-20 swings later.
    await sleep(500);
    st = await nefState();
    seen.enrage = true;
    console.log(`ENRAGE live: hp ${st.hpPct}% server enraged=${st.enraged} ringVisible=${st.enrageVisible} aoes=${st.aoes}`);
    await capShot(cdp, "neferet_live_p3_enrage");
  }
  if (hp === 0) {
    await hold(null);
    deaths += 1;
    console.log(`died (${deaths}x), waiting for respawn; boss hp ${st.hpPct}%`);
    await sleep(6000);
    continue;
  }
  const dist = Math.hypot(st.x - pos[0], st.y - pos[1]);
  // Attack arc is 2.5 m — only swing inside 2.2 m, else step in.
  if (dist > 2.2) {
    await hold(keyFor(st.x - pos[0], st.y - pos[1]));
    if (Date.now() - lastLog > 10000) {
      lastLog = Date.now();
      console.log(`walking: pos ${pos} dist ${dist.toFixed(1)} m boss hp ${st.hpPct}%`);
    }
    await sleep(400);
    continue;
  }
  await hold(null);
  // Re-face the boss with a LONG step, then ONE swing standing still.
  // The client renders at ~0.8 fps under SwiftShader, so a 200 ms key
  // hold spans zero frames and never sends an input — the facing froze
  // after the walk and every swing whiffed once the boss circled out of
  // the arc (run 4: 11% in 33 swings, then 0 in 126). Holding 1600 ms
  // guarantees >= 1 frame sends the new direction. One click per
  // re-face: the attack lunge carries the player past the boss, so
  // clicks 2-3 of a burst always whiff. Q = Corte Crescente (2.2x).
  await hold(keyFor(st.x - pos[0], st.y - pos[1]));
  await sleep(1600);
  await hold(null);
  await page.keyboard.press("KeyQ");
  await sleep(150);
  // One LMB click at viewport center (fires on the next render frame).
  await page.mouse.click(640, 360);
  swings += 1;
  // Let the attack fire (next frame, up to ~1.25 s) and complete
  // server-side before re-facing again.
  await sleep(1400);
  if (Date.now() - lastLog > 10000) {
    lastLog = Date.now();
    const dg = parseDiag(dbg);
    console.log(`fighting: boss hp ${st.hpPct}% enraged=${st.enraged} aoes=${st.aoes} swings=${swings} deaths=${deaths} corr=${dg.corr} estado=${dg.estado} rejects=${dg.rejects} fps=${dg.fps} alvo=${dg.alvo}`);
  }
}
await hold(null);
if (seen.dead) await capShot(cdp, "neferet_live_boss_down");
const final = await nefState();
console.log("FINAL:", JSON.stringify({ ...final, swings, deaths, seen, pageerrors: errors }));
await browser.close();
console.log("done");
