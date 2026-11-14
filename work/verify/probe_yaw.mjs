import { chromium } from 'playwright-core';
const OUT = '/home/hatch/workspace/azure-edge/docs/visual-verify/';
const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/azure-edge/work/verify/chrome/linux-157.0.8103.78/chrome-linux64/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('http://127.0.0.1:5174/?gender=m&class=espadachim&zone=cidade_serket&name=probe', { waitUntil: 'domcontentloaded', timeout: 60000 });
const debug = () => page.evaluate(() => document.getElementById('debug')?.textContent ?? '');
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  if ((await debug()).includes('players: 1')) break;
}
await page.waitForTimeout(4000);
await page.mouse.click(480, 270);
await page.waitForTimeout(300);
const pos = async () => (await debug()).split('\n').find((l) => l.startsWith('pos:'))?.trim();
console.log('spawn', await pos());
// walk south, sample yaw mid-walk
await page.keyboard.down('KeyS');
await page.waitForTimeout(500);
console.log('mid-S', await pos());
await page.waitForTimeout(700);
console.log('late-S', await pos());
await page.screenshot({ path: OUT + '132_male_yaw_south.png', timeout: 90000 });
await page.keyboard.up('KeyS');
await page.waitForTimeout(600);
console.log('idle-after-S', await pos());
// walk north, sample yaw mid-walk
await page.keyboard.down('KeyW');
await page.waitForTimeout(500);
console.log('mid-W', await pos());
await page.waitForTimeout(700);
console.log('late-W', await pos());
await page.screenshot({ path: OUT + '133_male_yaw_north.png', timeout: 90000 });
await page.keyboard.up('KeyW');
// attack: click, sample estado quickly
await page.mouse.click(480, 270);
await page.waitForTimeout(120);
console.log('attack+120ms', (await debug()).split('\n').find((l) => l.includes('estado:'))?.trim());
await page.waitForTimeout(200);
await page.screenshot({ path: OUT + '134_male_yaw_attack.png', timeout: 90000 });
console.log('attack shot estado', (await debug()).split('\n').find((l) => l.includes('estado:'))?.trim());
await browser.close();
console.log('done');
