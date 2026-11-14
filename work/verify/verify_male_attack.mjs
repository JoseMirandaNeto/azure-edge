import { chromium } from 'playwright-core';
const OUT = '/home/hatch/workspace/azure-edge/docs/visual-verify/';
const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/azure-edge/work/verify/chrome/linux-157.0.8103.78/chrome-linux64/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5174/?gender=m&class=espadachim&zone=cidade_serket&name=atk2', { waitUntil: 'domcontentloaded', timeout: 60000 });
const debug = () => page.evaluate(() => document.getElementById('debug')?.textContent ?? '');
const stateLine = async () => (await debug()).split('\n').find((l) => l.includes('estado:'))?.trim();
const posLine = async () => (await debug()).split('\n').find((l) => l.startsWith('pos:'))?.trim();
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  if ((await debug()).includes('players: 1')) break;
}
await page.waitForTimeout(5000);
await page.mouse.click(480, 270);
await page.waitForTimeout(500);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(300); }
// face south
await page.keyboard.down('KeyS');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyS');
await page.waitForTimeout(400);
console.log('facing:', await posLine(), '|', await stateLine());
// re-trigger the attack every 200ms while the screenshot is being taken
let stop = false;
const clickLoop = (async () => {
  while (!stop) {
    await page.mouse.click(480, 270).catch(() => {});
    await page.waitForTimeout(200);
  }
})();
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '145_male_rigged_city_attack.png', timeout: 240000 });
await page.screenshot({ path: OUT + '145_male_rigged_city_attack_crop.png', clip: { x: 330, y: 45, width: 300, height: 450 }, timeout: 240000 });
stop = true;
await clickLoop;
console.log('shot 145 |', await posLine(), '|', await stateLine());
console.log('console errors:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
console.log('done');
