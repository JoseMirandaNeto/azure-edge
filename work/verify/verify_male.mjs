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
// wait for player spawn (players: 1) up to 60s
let spawned = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const t = await debug();
  if (t.includes('players: 1')) { spawned = true; break; }
}
console.log('spawned:', spawned, 'glb200:', glbDone);
console.log((await debug()).replace(/\n/g, ' | '));
// let the GLB swap in (CharForge -> GLB) and settle
await page.waitForTimeout(4000);
console.log('after settle:', (await debug()).replace(/\n/g, ' | '));

// click canvas once (pointer lock) then focus keys
await page.mouse.click(640, 360);
await page.waitForTimeout(500);

async function shot(name) {
  await page.screenshot({ path: OUT + name + '.png', timeout: 90000 });
  await page.screenshot({ path: OUT + name + '_crop.png', clip: { x: 330, y: 45, width: 300, height: 450 }, timeout: 90000 });
  console.log('shot', name, '|', (await debug()).split('\n')[1]?.trim(), '|', (await debug()).split('\n')[7]?.trim());
}
async function holdKey(code, ms) {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
}

// 1. idle front: walk south (toward camera) then stop
await holdKey('KeyS', 1200);
await page.waitForTimeout(600);
await shot('120_male_rigged_idle_front');
// 2. idle back: walk north (away) then stop
await holdKey('KeyW', 1200);
await page.waitForTimeout(600);
await shot('121_male_rigged_idle_back');
// 3. walking south (front view, legs mid-swing)
await page.keyboard.down('KeyS');
await page.waitForTimeout(900);
await shot('122_male_rigged_walk_south');
await page.keyboard.up('KeyS');
await page.waitForTimeout(400);
// 4. walking north (back view, legs mid-swing)
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
await shot('123_male_rigged_walk_north');
await page.keyboard.up('KeyW');
await page.waitForTimeout(400);
// 5. attack: face south first, then click
await holdKey('KeyS', 800);
await page.waitForTimeout(300);
await page.mouse.click(640, 360);
await page.waitForTimeout(280);
await shot('124_male_rigged_attack');
await page.waitForTimeout(350);
await shot('125_male_rigged_attack_late');
// 6. guard/dodge sanity (Space = dodge)
await page.keyboard.press('Space');
await page.waitForTimeout(300);
await shot('126_male_rigged_dodge');

console.log('console errors:', JSON.stringify(errors.slice(0, 10), null, 1));
await browser.close();
