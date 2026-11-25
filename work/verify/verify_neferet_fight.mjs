// Neferet 3-phase fight: session A = real tumbas fight (walk to the boss,
// attack, confirm no client errors + hit feedback via the debug overlay);
// session B = injected visuals in the city (sand-rain decal + enrage ring
// via __aeView.updateMob with a fake entity — the real fight needs ~26k
// damage to reach phase 2, not reachable by playing as lv 1).
// Uso: node verify_neferet_fight.mjs  (server-game local na :3001 requerido)
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
  page.on("pageerror", (e) => { console.log(`[${tag} pageerror]`, String(e).slice(0, 300)); errors.push(tag); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(4000);
  await page.mouse.click(160, 90);
  await sleep(300);
  const cdp = await context.newCDPSession(page);
  await fn(page, cdp);
  await page.close();
  await context.close();
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

/** Debug overlay text (#debug): pos, hp, alvo (nearest mob hp + dist), server tick. */
async function debugText(page) {
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
function parseAlvo(t) {
  const m = t.match(/alvo: (.+?) hp (\d+)% a ([\d.]+) m/);
  return m ? { name: m[1], hp: +m[2], d: +m[3] } : null;
}

// Session A: tumbas — walk south to the boss (0,-20), attack, screenshot.
await zone(`${BASE}/?class=espadachim&gender=f&name=NEF&dungeon=tumbas`, async (p, cdp) => {
  // Wait for the first real snapshot (server tick + boss in the view's mobs);
  // "pos:" alone is not enough — the debug overlay updates before any snapshot.
  let bossPos = null;
  for (let i = 0; i < 30; i += 1) {
    const dbg = await debugText(p);
    if (/server tick: \d+/.test(dbg)) {
      bossPos = await p.evaluate(() => {
        const v = window.__aeView;
        if (!v) return null;
        for (const e of v.mobs.values()) {
          if (e.mobId === "neferet") return [+e.group.position.x.toFixed(1), -+e.group.position.z.toFixed(1)];
        }
        return null;
      });
      if (bossPos) break;
    }
    await sleep(1000);
  }
  console.log("tumbas boss server pos:", JSON.stringify(bossPos));
  if (!bossPos) throw new Error("neferet not found in tumbas");
  let dbg = await debugText(p);
  console.log("tumbas connected:", JSON.stringify(dbg.split("\n").slice(5, 9)));
  // Closed-loop steering: S = -y (boss is south), W = +y, A/D = -x/+x.
  const keyFor = (dx, dy) => (Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "KeyS" : "KeyW") : (dx < 0 ? "KeyA" : "KeyD"));
  let held = null;
  const hold = async (key) => {
    if (held === key) return;
    if (held) await p.keyboard.up(held);
    if (key) await p.keyboard.down(key);
    held = key;
  };
  let dist = 99;
  let dodges = 0;
  for (let i = 0; i < 150; i += 1) {
    dbg = await debugText(p);
    const pos = parsePos(dbg);
    const hp = parseHp(dbg);
    if (!pos || !bossPos) break;
    dist = Math.hypot(bossPos[0] - pos[0], bossPos[1] - pos[1]);
    if (dist <= 3.5) break;
    if (hp === 0) { await hold(null); console.log("tumbas: died walking, waiting for respawn"); await sleep(6000); continue; }
    await hold(keyFor(bossPos[0] - pos[0], bossPos[1] - pos[1]));
    // Dodge through the spawn pack: i-frames + a speed burst (player 6 m/s
    // outruns the trash chase 3-4 m/s, but the pack is on top of the spawn).
    if (i % 3 === 2) { await p.keyboard.press("Space"); dodges += 1; }
    if (i % 5 === 0) console.log(`tumbas walk: pos ${pos} dist ${dist.toFixed(1)} m hp ${hp}%`);
    await sleep(400);
  }
  await hold(null);
  console.log("tumbas arrived: dist", dist.toFixed(1), "m, dodges:", dodges);
  // Attack: LMB clicks at the viewport center (1280x720), 8 swings.
  await p.setViewportSize({ width: 1280, height: 720 });
  await sleep(500);
  const dmgBefore = await p.evaluate(() => document.getElementById("dmg-layer")?.children.length ?? 0);
  const alvoBefore = parseAlvo(await debugText(p));
  let swings = 0;
  for (let i = 0; i < 10; i += 1) {
    await p.mouse.click(640, 360);
    await sleep(250);
    const st = await debugText(p);
    if (st.includes("estado: attack")) swings += 1;
    await sleep(250);
  }
  await sleep(500);
  const dmgAfter = await p.evaluate(() => document.getElementById("dmg-layer")?.children.length ?? 0);
  const alvoAfter = parseAlvo(await debugText(p));
  console.log("tumbas attack: swings seen", swings, "/ 8 | dmg-layer children", dmgBefore, "->", dmgAfter, "| alvo before:", JSON.stringify(alvoBefore), "after:", JSON.stringify(alvoAfter));
  await capShot(p, cdp, "neferet_fight_tumbas_attack");
}, "tumbas");

// Session B: city — injected visuals: fake Neferet, enraged + sand-rain
// decal (frac 0.5), then a clean state (no enrage, no rain) as control.
await zone(`${BASE}/?class=espadachim&gender=f&name=NEF`, async (p, cdp) => {
  let dbg = "";
  for (let i = 0; i < 30; i += 1) {
    dbg = await debugText(p);
    if (dbg.includes("pos:")) break;
    await sleep(1000);
  }
  const pos = parsePos(dbg) ?? [0, 0];
  const fx = +(pos[0] + 1).toFixed(1);
  const fy = +(pos[1] + 3).toFixed(1);
  console.log("city player pos:", JSON.stringify(pos), "fake neferet at:", JSON.stringify([fx, fy]));
  const TICK = 1000000;
  const state = await p.evaluate(([fx, fy, TICK]) => {
    const v = window.__aeView;
    if (!v) return null;
    const fake = {
      id: 9001, kind: "mob", name: "Neferet", mobId: "neferet", level: 12,
      x: fx, y: fy, yaw: Math.PI, animState: 0, hpPct: 20,
      enraged: true, aoes: [{ x: fx, y: fy, radius: 3, untilTick: TICK + 10 }],
    };
    v.updateMob(fake, TICK);
    const e = v.mobs.get(9001);
    if (!e) return { created: false };
    return {
      created: true,
      enrageVisible: !!e.enrage?.visible,
      decalVisible: !!e.aoes?.[0]?.visible,
      discScale: e.aoes?.[0] ? +e.aoes[0].userData.disc.scale.x.toFixed(2) : null,
      decalScale: e.aoes?.[0] ? +e.aoes[0].scale.x.toFixed(2) : null,
    };
  }, [fx, fy, TICK]);
  console.log("city injected state:", JSON.stringify(state));
  // Wait for the GLB swap (procedural is fine too, but GLB reads better).
  for (let i = 0; i < 30; i += 1) {
    const glb = await p.evaluate(() => window.__aeView?.mobs.get(9001)?.glb ?? false);
    if (glb) { console.log("city fake neferet glb: true"); break; }
    await sleep(1000);
  }
  await capShot(p, cdp, "neferet_fight_rain_enrage_city");
  // Control: same entity, enrage off, rain gone — visuals must disappear.
  const state2 = await p.evaluate(([fx, fy, TICK]) => {
    const v = window.__aeView;
    if (!v) return null;
    v.updateMob({
      id: 9001, kind: "mob", name: "Neferet", mobId: "neferet", level: 12,
      x: fx, y: fy, yaw: Math.PI, animState: 0, hpPct: 20,
    }, TICK);
    const e = v.mobs.get(9001);
    return { enrageVisible: !!e.enrage?.visible, decalVisible: !!e.aoes?.[0]?.visible };
  }, [fx, fy, TICK]);
  console.log("city control state:", JSON.stringify(state2));
  await capShot(p, cdp, "neferet_fight_clean_city");
}, "city");

await browser.close();
console.log("pageerrors:", JSON.stringify(errors));
console.log("done");
