import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/azure-edge/work/verify/chrome/linux-157.0.8103.78/chrome-linux64/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('http://127.0.0.1:5174/?gender=m&class=espadachim&zone=cidade_serket&name=probe2', { waitUntil: 'domcontentloaded', timeout: 60000 });
const debug = () => page.evaluate(() => document.getElementById('debug')?.textContent ?? '');
const rigLine = async () => (await debug()).split('\n').find((l) => l.startsWith('rig:'))?.trim();
const posLine = async () => (await debug()).split('\n').find((l) => l.startsWith('pos:'))?.trim();
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(1000);
  const t = await debug();
  if (t.includes('players: 1')) break;
}
await page.waitForTimeout(5000);
console.log('spawn', await posLine(), '|', await rigLine());
await page.mouse.click(480, 270);
await page.waitForTimeout(500);
// walk south 2s, sampling rig phase (phase advances only while animState==1)
await page.keyboard.down('KeyS');
for (let k = 0; k < 4; k++) {
  await page.waitForTimeout(500);
  console.log('walk-S', await posLine(), '|', await rigLine());
}
await page.keyboard.up('KeyS');
await page.waitForTimeout(500);
console.log('idle', await posLine(), '|', await rigLine());
// attack
await page.mouse.click(480, 270);
await page.waitForTimeout(400);
console.log('attack', await posLine(), '|', await rigLine());
await page.waitForTimeout(400);
console.log('attack+400', await rigLine());
await browser.close();
console.log('done');
