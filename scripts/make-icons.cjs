// Renders public/icon.svg to the PNG sizes the PWA manifest and iOS need.
// Usage: node scripts/make-icons.cjs   (requires playwright to be installed)
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const pub = path.join(__dirname, '..', 'public');
const svg = readFileSync(path.join(pub, 'icon.svg'), 'utf8');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size] of [['pwa-192.png', 192], ['pwa-512.png', 512], ['apple-touch-icon.png', 180]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:#27384f">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(pub, name) });
  }
  await browser.close();
})();
