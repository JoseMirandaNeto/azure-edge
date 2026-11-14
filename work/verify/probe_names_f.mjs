import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/azure-edge/work/verify/chrome/linux-157.0.8103.78/chrome-linux64/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('http://127.0.0.1:5174/?gender=f&class=espadachim&zone=cidade_serket&name=probeF', { waitUntil: 'domcontentloaded', timeout: 60000 });
const debug = () => page.evaluate(() => document.getElementById('debug')?.textContent ?? '');
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(1000);
  const t = await debug();
  if (t.includes('players: 1')) break;
}
await page.waitForTimeout(6000);
const rigLine = (await debug()).split('\n').find((l) => l.startsWith('rig:'))?.trim();
console.log(rigLine);
await browser.close();
console.log('done');
