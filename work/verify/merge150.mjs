// Merge verification (round 3): Serket + golem rework, female GLB rig
// post-fix (walk/attack, weapon in hand), male GLB, city/dunes/tumbas/templo.
// Serves apps/client/dist via route interception (no vite needed); WS to
// the local server-game on :3001 stays live. Usage: node merge150.mjs
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

async function shot(page, cdp, name) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(3500);
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
  if (!last) { console.log(tag, "no local player (disconnected?)"); return; }
  let stuck = 0;
  while (Date.now() - t0 < budgetMs) {
    const p = (await playerPos(page)) ?? last;
    const dx = tx - p.x;
    const dz = tz - p.z;
    if (Math.hypot(dx, dz) < 1.2) break;
    const leg = (key, ms) => walk(page, key, Math.min(ms, 3500));
    if (Math.abs(dz) > 0.7) await leg(dz < 0 ? "KeyW" : "KeyS", (Math.abs(dz) / 0.8) * 1000);
    else if (Math.abs(dx) > 0.7) await leg(dx > 0 ? "KeyD" : "KeyA", (Math.abs(dx) / 0.8) * 1000);
    const p2 = (await playerPos(page)) ?? p;
    if (Math.hypot(p2.x - p.x, p2.z - p.z) < 0.4) {
      stuck += 1;
      await walk(page, stuck % 2 ? "KeyD" : "KeyA", 1500);
    } else stuck = 0;
    last = p2;
  }
  console.log(tag, "at", JSON.stringify(await playerPos(page)));
}

/** Rig report for the LOCAL player: GLB? bone count, hand children (weapon
 *  attached?), thigh rotation (pose advancing?). */
async function rigReport(page, tag) {
  const r = await page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return { error: "no __aeView" };
    const entry = [...v.players.values()].find((e) => e.group && v.localId !== null && e === v.players.get(v.localId));
    if (!entry) return { error: "no local entry" };
    const rig = entry.rig ?? null;
    let skinned = 0;
    let defBones = 0;
    const handNames = [];
    entry.group.traverse((o) => {
      if (o.isSkinnedMesh) skinned += 1;
      if (typeof o.name === "string" && o.name.startsWith("DEF-")) defBones += 1;
      if (typeof o.name === "string" && /hand/i.test(o.name)) {
        handNames.push({ name: o.name, children: o.children.map((c) => c.name || c.type), rotX: +o.rotation.x.toFixed(2) });
      }
    });
    const thigh = [];
    entry.group.traverse((o) => {
      if (typeof o.name === "string" && o.name.startsWith("DEF-thigh")) {
        thigh.push({ name: o.name, rotX: +o.rotation.x.toFixed(2), rotZ: +o.rotation.z.toFixed(2) });
      }
    });
    const debug = document.getElementById("debug")?.textContent ?? "";
    const estado = (debug.split("\n").find((l) => l.includes("estado:")) ?? "").trim();
    return {
      hasRig: !!rig,
      skinnedMeshes: skinned,
      defBones,
      handR: rig?.handR ? { name: rig.handR.name, children: rig.handR.children.map((c) => c.name || c.type) } : null,
      handL: rig?.handL ? { name: rig.handL.name, children: rig.handL.children.map((c) => c.name || c.type) } : null,
      handNodes: handNames.slice(0, 6),
      thigh: thigh.slice(0, 4),
      estado,
    };
  });
  console.log(`RIG ${tag}`, JSON.stringify(r));
  return r;
}

async function zone(url, shots, tag) {
  const context = await browser.newContext({ viewport: { width: 320, height: 180 } });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") { await route.abort(); return; }
    let rel = decodeURIComponent(u.pathname);
    if (rel === "/") rel = "/index.html";
    try {
      await route.fulfill({ body: await readFile(`${DIST}${rel}`), contentType: mime(rel), status: 200 });
    } catch {
      await route.fulfill({ body: "not found", status: 404 });
    }
  });
  page.on("pageerror", (e) => console.log(`[${tag} pageerror]`, String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") console.log(`[${tag} console]`, m.text().slice(0, 200)); });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await sleep(12000); // GLBs load in background
  const ae = await page.evaluate(() => {
    const v = window.__aeView;
    if (!v) return null;
    return { backend: v.backend, players: v.players.size, sceneryTemplates: [...v.sceneryTemplates.keys()] };
  });
  console.log(`loaded ${tag}`, JSON.stringify(ae));
  await page.mouse.click(160, 90);
  await sleep(300);
  const cdp = await context.newCDPSession(page);
  for (const [name, act] of shots) {
    if (act) await act(page, cdp);
    else await shot(page, cdp, name);
  }
  await page.close();
  await context.close();
}

// --- A. Female GLB (post-fix): idle / walk front+back / attack -------------
await zone(`${BASE}/?class=espadachim&gender=f&name=MergeF`, [
  ["150_city_spawn", null],
  ["150_female_walk_front", async (p, cdp) => {
    await rigReport(p, "female idle");
    await p.keyboard.down("KeyS"); // south = toward camera = front view
    await sleep(6000);
    await rigReport(p, "female walk-S mid");
    await shot(p, cdp, "150_female_walk_front");
    await p.keyboard.up("KeyS");
    await sleep(500);
  }],
  ["150_female_walk_back", async (p, cdp) => {
    await p.keyboard.down("KeyW"); // north = away = back view
    await sleep(6000);
    await rigReport(p, "female walk-W mid");
    await shot(p, cdp, "150_female_walk_back");
    await p.keyboard.up("KeyW");
    await sleep(500);
  }],
  ["150_female_attack", async (p, cdp) => {
    await p.setViewportSize({ width: 1280, height: 720 });
    await sleep(1000);
    await p.mouse.click(640, 360); // LMB attack
    await sleep(400);
    let data = null;
    try { ({ data } = await cdp.send("Page.captureScreenshot", { format: "png" })); } catch {}
    if (data) await writeFile(`${OUT}150_female_attack.png`, Buffer.from(data, "base64"));
    await sleep(600);
    await rigReport(p, "female after attack");
    await p.setViewportSize({ width: 320, height: 180 });
    console.log("150_female_attack captured");
  }],
], "female");

// --- B. Male GLB: walk front + attack ---------------------------------------
await zone(`${BASE}/?class=espadachim&gender=m&name=MergeM`, [
  ["150_male_walk_front", async (p, cdp) => {
    await rigReport(p, "male idle");
    await p.keyboard.down("KeyS");
    await sleep(6000);
    await rigReport(p, "male walk-S mid");
    await shot(p, cdp, "150_male_walk_front");
    await p.keyboard.up("KeyS");
    await sleep(500);
  }],
  ["150_male_attack", async (p, cdp) => {
    await p.setViewportSize({ width: 1280, height: 720 });
    await sleep(1000);
    await p.mouse.click(640, 360);
    await sleep(400);
    let data = null;
    try { ({ data } = await cdp.send("Page.captureScreenshot", { format: "png" })); } catch {}
    if (data) await writeFile(`${OUT}150_male_attack.png`, Buffer.from(data, "base64"));
    await sleep(600);
    await rigReport(p, "male after attack");
    await p.setViewportSize({ width: 320, height: 180 });
    console.log("150_male_attack captured");
  }],
], "male");

// --- C. Dunas capsule: Serket + golem close-ups ----------------------------
await zone(`${BASE}/?class=espadachim&gender=f&name=MergeD&zone=dunas_serket&testmobs=serket,golem_areia&char=capsule`, [
  ["150_dunas_spawn", null],
  ["150_serket_dunas", async (p, cdp) => {
    const s = await p.evaluate(() => {
      const v = window.__aeView;
      for (const t of v.testMobs) {
        const pos = t.group.position;
        return { x: +pos.x.toFixed(1), z: +pos.z.toFixed(1) };
      }
      return null;
    });
    console.log("testmobs[0] at", JSON.stringify(s));
    if (s) await goto(p, s.x, s.z + 4.5, "approach serket", 60000);
    await shot(p, cdp, "150_serket_dunas");
  }],
  ["150_golem_dunas", async (p, cdp) => {
    const s = await p.evaluate(() => {
      const v = window.__aeView;
      const t = v.testMobs[1];
      if (!t) return null;
      return { x: +t.group.position.x.toFixed(1), z: +t.group.position.z.toFixed(1) };
    });
    console.log("testmobs[1] at", JSON.stringify(s));
    if (s) await goto(p, s.x, s.z + 4.5, "approach golem", 60000);
    await shot(p, cdp, "150_golem_dunas");
  }],
], "dunas");

// --- D. City capsule: Serket + golem (parity with 10x shots) ---------------
await zone(`${BASE}/?class=espadachim&gender=f&name=MergeC&testmobs=serket,golem_areia&char=capsule`, [
  ["150_serket_city", async (p, cdp) => {
    const s = await p.evaluate(() => {
      const v = window.__aeView;
      const t = v.testMobs[0];
      return t ? { x: +t.group.position.x.toFixed(1), z: +t.group.position.z.toFixed(1) } : null;
    });
    if (s) await goto(p, s.x, s.z + 4.5, "approach serket city", 60000);
    await shot(p, cdp, "150_serket_city");
  }],
  ["150_golem_city", async (p, cdp) => {
    const s = await p.evaluate(() => {
      const v = window.__aeView;
      const t = v.testMobs[1];
      return t ? { x: +t.group.position.x.toFixed(1), z: +t.group.position.z.toFixed(1) } : null;
    });
    if (s) await goto(p, s.x, s.z + 4.5, "approach golem city", 60000);
    await shot(p, cdp, "150_golem_city");
  }],
], "city-mobs");

// --- E. Templo: Serket (best effort; spawn-inside-temple is a server bug) ---
await zone(`${BASE}/?class=espadachim&gender=f&name=MergeT&dungeon=templo&testmobs=serket&char=capsule`, [
  ["150_serket_templo", async (p, cdp) => {
    const s = await p.evaluate(() => {
      const v = window.__aeView;
      const t = v.testMobs[0];
      return t ? { x: +t.group.position.x.toFixed(1), z: +t.group.position.z.toFixed(1) } : null;
    });
    console.log("templo serket at", JSON.stringify(s));
    if (s) await goto(p, s.x, s.z + 4.5, "approach serket templo", 60000);
    await shot(p, cdp, "150_serket_templo");
  }],
], "templo");

// --- F. Tumbas: Neferet + spawn ---------------------------------------------
await zone(`${BASE}/?class=espadachim&gender=f&name=MergeN&dungeon=tumbas&testmobs=neferet&char=capsule`, [
  ["150_tumbas_spawn", null],
  ["150_neferet_tumbas", async (p, cdp) => {
    const s = await p.evaluate(() => {
      const v = window.__aeView;
      const t = v.testMobs[0];
      return t ? { x: +t.group.position.x.toFixed(1), z: +t.group.position.z.toFixed(1) } : null;
    });
    if (s) await goto(p, s.x, s.z + 4.5, "approach neferet", 60000);
    await shot(p, cdp, "150_neferet_tumbas");
  }],
], "tumbas");

await browser.close();
console.log("done");
