import { chromium } from 'playwright-core';

const OUT = '/home/hatch/workspace/azure-edge/docs/visual-verify/';
const BASE = 'http://127.0.0.1:5174/?gender=m&class=espadachim&zone=cidade_serket';

const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/azure-edge/work/verify/chrome/linux-157.0.8103.78/chrome-linux64/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => errors.push('REQFAIL ' + r.url()));

let glbDone = false;
page.on('response', (r) => {
  if (r.url().includes('warrior_m_r64_final_rigged.glb')) glbDone = r.status() === 200;
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
const debug = () => page.evaluate(() => document.getElementById('debug')?.textContent ?? '');
const rigLine = async () => (await debug()).split('\n').find((l) => l.startsWith('rig:'))?.trim();
const posLine = async () => (await debug()).split('\n').find((l) => l.startsWith('pos:'))?.trim();
const stateLine = async () => (await debug()).split('\n').find((l) => l.includes('estado:'))?.trim();
let spawned = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const t = await debug();
  if (t.includes('players: 1')) { spawned = true; break; }
}
console.log('spawned:', spawned, 'glb200:', glbDone);
await page.waitForTimeout(5000);
console.log('settle:', await posLine(), '|', await rigLine());
await page.mouse.click(480, 270);
await page.waitForTimeout(500);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(300); }

async function shot(name) {
  await page.screenshot({ path: OUT + name + '.png', timeout: 240000 });
  await page.screenshot({ path: OUT + name + '_crop.png', clip: { x: 330, y: 45, width: 300, height: 450 }, timeout: 240000 });
  console.log('shot', name, '|', await posLine(), '|', await rigLine(), '|', await stateLine());
}
async function holdKey(code, ms) {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
}

// idle front: walk south (toward camera) long enough for the slow loop
await holdKey('KeyS', 2500);
await page.waitForTimeout(800);
await shot('139_male_rigged_city_idle_front');
// idle back: walk north (wall is ~3m ahead; enough to set facing north)
await holdKey('KeyW', 2500);
await page.waitForTimeout(800);
await shot('140_male_rigged_city_idle_back');
// walk east (profile view, open plaza): hold D, screenshot while holding
await page.keyboard.down('KeyD');
await page.waitForTimeout(2500);
await shot('141_male_rigged_city_walk_east');
await page.keyboard.up('KeyD');
await page.waitForTimeout(500);
// walk south (front view): hold S, screenshot while holding
await page.keyboard.down('KeyS');
await page.waitForTimeout(2500);
await shot('142_male_rigged_city_walk_south');
await page.keyboard.up('KeyS');
await page.waitForTimeout(500);
// attack: face south first, then click and shoot fast
await holdKey('KeyS', 2000);
await page.waitForTimeout(400);
await page.mouse.click(480, 270);
await page.waitForTimeout(150);
await shot('143_male_rigged_city_attack');
await page.waitForTimeout(400);
await shot('144_male_rigged_city_attack_late');

console.log('console errors:', JSON.stringify(errors.slice(0, 10), null, 1));
await browser.close();
console.log('done');
