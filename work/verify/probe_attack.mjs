import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/azure-edge/work/verify/chrome/linux-157.0.8103.78/chrome-linux64/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('http://127.0.0.1:5174/?gender=m&class=espadachim&zone=cidade_serket&name=probeA', { waitUntil: 'domcontentloaded', timeout: 60000 });
const debug = () => page.evaluate(() => document.getElementById('debug')?.textContent ?? '');
const stateLine = async () => (await debug()).split('\n').find((l) => l.includes('estado:'))?.trim();
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  if ((await debug()).includes('players: 1')) break;
}
await page.waitForTimeout(5000);
await page.mouse.click(480, 270);
await page.waitForTimeout(500);
// face south first so the attack is visible from the front
await page.keyboard.down('KeyS');
await page.waitForTimeout(2000);
await page.keyboard.up('KeyS');
await page.waitForTimeout(500);
console.log('before click:', await stateLine());
await page.mouse.click(480, 270);
for (const ms of [100, 300, 600, 900, 1300]) {
  await page.waitForTimeout(ms === 100 ? 100 : ms - [100, 300, 600, 900, 1300][[100, 300, 600, 900, 1300].indexOf(ms) - 1]);
  console.log(`+${ms}ms:`, await stateLine());
}
await browser.close();
console.log('done');
