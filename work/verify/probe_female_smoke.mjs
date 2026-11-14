import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/azure-edge/work/verify/chrome/linux-157.0.8103.78/chrome-linux64/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5174/?gender=f&class=espadachim&zone=cidade_serket&name=fsmoke', { waitUntil: 'domcontentloaded', timeout: 60000 });
const debug = () => page.evaluate(() => document.getElementById('debug')?.textContent ?? '');
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  if ((await debug()).includes('players: 1')) break;
}
await page.waitForTimeout(5000);
await page.mouse.click(480, 270);
await page.waitForTimeout(500);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(300); }
await page.screenshot({ path: '/home/hatch/workspace/azure-edge/docs/visual-verify/146_female_smoke_after_fix.png', timeout: 240000 });
console.log('errors:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
console.log('done');
