// Renders the ShelfScan icon into the Android launcher icons and splash screens.
// Usage: node scripts/make-android-assets.cjs   (requires playwright)
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon.svg'), 'utf8');
const art = svg.replace(/<rect width="512" height="512"[^>]*\/>/, ''); // icon without its background
const BG = 'linear-gradient(135deg,#6366f1,#8b5cf6)';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (html, w, h, file, transparent = false) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden">${html}</body></html>`);
    await page.screenshot({ path: file, omitBackground: transparent });
  };
  const sized = (s, px) => s.replace('<svg ', `<svg width="${px}" height="${px}" `);
  for (const [d, k] of Object.entries(densities)) {
    const dir = path.join(res, `mipmap-${d}`);
    const L = Math.round(48 * k), F = Math.round(108 * k);
    await shot(sized(svg, L), L, L, path.join(dir, 'ic_launcher.png'), true);
    await shot(`<div style="width:${L}px;height:${L}px;border-radius:50%;overflow:hidden;background:${BG}">${sized(art, L)}</div>`, L, L, path.join(dir, 'ic_launcher_round.png'), true);
    await shot(sized(art, F), F, F, path.join(dir, 'ic_launcher_foreground.png'), true);
  }
  for (const dir of fs.readdirSync(res).filter((n) => n.startsWith('drawable'))) {
    const f = path.join(res, dir, 'splash.png');
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f); // PNG IHDR width/height
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const icon = Math.round(Math.min(w, h) * 0.32);
    await shot(`<div style="width:${w}px;height:${h}px;display:grid;place-items:center;background:${BG}">${sized(art, icon)}</div>`, w, h, f);
  }
  await browser.close();
})();
