import { chromium } from 'playwright-core';
const OUT = '/home/hatch/workspace/azure-edge/docs/visual-verify/';
const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/azure-edge/work/verify/chrome/linux-157.0.8103.78/chrome-linux64/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
async function run(gender, tag) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log(tag, 'PAGEERROR', String(e)));
  await page.goto(`http://127.0.0.1:5174/?gender=${gender}&class=espadachim&zone=cidade_serket`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const debug = () => page.evaluate(() => document.getElementById('debug')?.textContent ?? '');
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    if ((await debug()).includes('players: 1')) break;
  }
  await page.waitForTimeout(4000);
  await page.mouse.click(480, 270);
  await page.waitForTimeout(300);
  const pos = async () => (await debug()).split('\n').find((l) => l.startsWith('pos:'))?.trim();
  console.log(tag, 'spawn', await pos());
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(600);
  console.log(tag, 'after S', await pos());
  await page.screenshot({ path: OUT + tag + '_south.png', timeout: 90000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(600);
  console.log(tag, 'after W', await pos());
  await page.screenshot({ path: OUT + tag + '_north.png', timeout: 90000 });
  await page.close();
}
await run('f', '130_female_facing');
await run('m', '131_male_facing');
await browser.close();
console.log('done');
