// Serket 3-phase fight, LIVE: real templo fight with dev-only playtest
// hooks (AZURE_EDGE_TEST_ATK_MULT=1000 + AZURE_EDGE_TEST_HP_MULT=1000 +
// AZURE_EDGE_TEST_SERKET_ENRAGE_TICKS=1200, server local :3001,
// NODE_ENV != production) so a lv 1 tester can reach her later phases
// in live play (her scaled HP is 138.600). ATK_MULT=1000 because the
// probe only lands ~11% of its swings on the boss (trash mobs eat the
// arc, the boss circles out of it) — each landed hit is ~9.250 HP, so
// ~1.000 HP/swing to the boss. HP_MULT=1000 (100.000 HP) because the
// lv 14-15 trash + Serket kill a lv 1 tester every ~1 min and each death
// costs ~90 s of walk-back; with 100k HP the tester survives the fight.
//  - P1: tail sting — server stingUntilTick > 0 AND the 270° sector visible
//  - P2 (<66%): summon — alfa count +2 AND server superArmor + cyan ring visible
//  - P3 (<33%): poison pools — server aoes[] (kind poison) AND green decal visible
//  - enrage (1-min test timer): server enraged=true AND red ring visible
//  - boss hp 0: fight ends
// Uso: AZURE_EDGE_TEST_ATK_MULT=1000 AZURE_EDGE_TEST_HP_MULT=1000 AZURE_EDGE_TEST_SERKET_ENRAGE_TICKS=1200 node apps/server-game/dist/index.js &
//      node work/verify/verify_serket_phases_live.mjs
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
await page.goto(`${BASE}/?class=espadachim&gender=f&name=SERK&dungeon=templo`, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(4000);
await page.mouse.click(640, 360);
await sleep(300);

// Intercept updateMob: record the latest REAL server snapshot for Serket
// (hpPct/enraged/superArmor/stingUntilTick/aoes) — the view entry itself keeps no hpPct.
await page.evaluate(() => {
  const v = window.__aeView;
  if (!v || v.__serkHooked) return;
  const orig = v.updateMob.bind(v);
  window.__serk = null;
  v.__serkHooked = true;
  v.updateMob = (e, tick) => {
    if (e.mobId === "serket") {
      window.__serk = {
        hpPct: e.hpPct, enraged: e.enraged, superArmor: e.superArmor,
        stingUntilTick: e.stingUntilTick ?? 0,
        aoes: (e.aoes ?? []).length,
        poisonAoes: (e.aoes ?? []).filter((a) => a.kind === "poison").length,
        x: e.x, y: e.y,
      };
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
async function serkState() {
  return page.evaluate(() => {
    const v = window.__aeView;
    const snap = window.__serk;
    if (!v || !snap) return null;
    let entry = null;
    for (const e of v.mobs.values()) if (e.mobId === "serket") entry = e;
    const alfas = [...v.mobs.values()].filter((e) => e.mobId === "escorpiao_alfa").length;
    // Green pool decal = the disc material color is 0x44ff66 (kind poison).
    const poolGreen = entry?.aoes?.some((a) => {
      if (!a.visible) return false;
      const disc = a.userData?.disc;
      return disc && disc.material && disc.material.color && disc.material.color.getHex() === 0x44ff66;
    }) ?? false;
    return {
      ...snap,
      decalVisible: entry?.aoes?.some((a) => a.visible) ?? false,
      poolGreen,
      stingVisible: entry?.sting?.visible ?? false,
      superArmorVisible: entry?.superArmor?.visible ?? false,
      enrageVisible: entry?.enrage?.visible ?? false,
      glb: entry?.glb ?? false,
      alfas,
    };
  });
}

const cdp = await context.newCDPSession(page);
// Wait for the first real snapshot with Neferet in it.
let st = null;
for (let i = 0; i < 30; i += 1) {
  st = await serkState();
  if (st) break;
  await sleep(1000);
}
if (!st) throw new Error("serket never appeared in snapshots");
console.log("boss initial:", JSON.stringify(st));
const alfas0 = st.alfas;

// Closed-loop steering: S = -y (boss is south), W = +y, A/D = -x/+x.
const keyFor = (dx, dy) => (Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "KeyS" : "KeyW") : (dx < 0 ? "KeyA" : "KeyD"));
let held = null;
const hold = async (key) => {
  if (held === key) return;
  if (held) await page.keyboard.up(held);
  if (key) await page.keyboard.down(key);
  held = key;
};

const seen = { sting: false, p2: false, pools: false, enrage: false, dead: false };
const t0 = Date.now();
let swings = 0;
let deaths = 0;
let lastLog = 0;
while (Date.now() - t0 < 720000) {
  st = await serkState();
  const dbg = await debugText();
  const pos = parsePos(dbg);
  const hp = parseHp(dbg);
  if (!st || !pos) { await sleep(500); continue; }
  if (st.hpPct <= 0) { seen.dead = true; console.log("boss DOWN, hpPct 0"); break; }
  // Phase checkpoints (server truth + client visuals).
  if (!seen.sting && st.stingUntilTick > 0) {
    seen.sting = true;
    console.log(`STING live: hp ${st.hpPct}% server stingUntilTick=${st.stingUntilTick} sectorVisible=${st.stingVisible}`);
    await capShot(cdp, "serket_live_p1_sting");
  }
  if (!seen.p2 && st.hpPct <= 66) {
    // Wait a tick for the client to show the ring, then capture fast:
    // the 5 s channel ends and the ring hides.
    await sleep(500);
    st = await serkState();
    seen.p2 = true;
    console.log(`P2 summon: hp ${st.hpPct}% alfas ${alfas0} -> ${st.alfas} server superArmor=${st.superArmor} ringVisible=${st.superArmorVisible}`);
    await capShot(cdp, "serket_live_p2_summon");
  }
  if (!seen.pools && st.poisonAoes > 0) {
    seen.pools = true;
    console.log(`POOLS live: hp ${st.hpPct}% server poisonAoes=${st.poisonAoes} decalVisible=${st.decalVisible} poolGreen=${st.poolGreen}`);
    await capShot(cdp, "serket_live_p3_pools");
  }
  if (!seen.enrage && st.enraged === true) {
    await sleep(500);
    st = await serkState();
    seen.enrage = true;
    console.log(`ENRAGE live: hp ${st.hpPct}% server enraged=${st.enraged} ringVisible=${st.enrageVisible} aoes=${st.aoes}`);
    await capShot(cdp, "serket_live_p3_enrage");
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
    console.log(`fighting: boss hp ${st.hpPct}% enraged=${st.enraged} superArmor=${st.superArmor} aoes=${st.aoes} alfas=${st.alfas} swings=${swings} deaths=${deaths} corr=${dg.corr} estado=${dg.estado} rejects=${dg.rejects} fps=${dg.fps} alvo=${dg.alvo}`);
  }
}
await hold(null);
if (seen.dead) await capShot(cdp, "serket_live_boss_down");
const final = await serkState();
console.log("FINAL:", JSON.stringify({ ...final, swings, deaths, seen, pageerrors: errors }));
await browser.close();
console.log("done");
