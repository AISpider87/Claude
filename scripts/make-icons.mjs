// Renders public/icons/*.png from the emblem SVG with the pre-installed Chromium.
//   node scripts/make-icons.mjs
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const SHIELD = (pad, size) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <defs>
    <linearGradient id="s" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#38bdf8" stop-opacity="0.04"/>
    </linearGradient>
  </defs>
  <g transform="translate(32 32) scale(${1 - pad}) translate(-32 -32)">
    <polygon points="32,5 55,18.5 55,45.5 32,59 9,45.5 9,18.5" fill="url(#s)" stroke="#38bdf8" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M15 46.5 L28 33 L36 39 L49.5 19.5" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
    <circle cx="49.5" cy="19.5" r="3" fill="#38bdf8" opacity="0.8"/>
    <text x="32" y="40" text-anchor="middle" font-family="'Space Grotesk', ui-sans-serif, system-ui, sans-serif" font-weight="700" font-size="21" letter-spacing="-1" fill="#e6edf7">SL</text>
  </g>
</svg>`;

const page = (size, pad, radius) => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:transparent}#i{width:${size}px;height:${size}px;background:#05080f;border-radius:${radius}px;display:grid;place-items:center;overflow:hidden}</style>
</head><body><div id="i">${SHIELD(pad, size)}</div></body></html>`;

const targets = [
  { file: "icon-192.png", size: 192, pad: 0.06, radius: 40 },
  { file: "icon-512.png", size: 512, pad: 0.06, radius: 108 },
  { file: "maskable-512.png", size: 512, pad: 0.26, radius: 0 },
  { file: "apple-touch-icon.png", size: 180, pad: 0.08, radius: 0 },
];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
await mkdir("public/icons", { recursive: true });
for (const t of targets) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: t.size, height: t.size });
  await p.setContent(page(t.size, t.pad, t.radius), { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  const png = await p.locator("#i").screenshot({ omitBackground: true });
  await writeFile(`public/icons/${t.file}`, png);
  console.log("wrote", t.file, png.length, "bytes");
  await p.close();
}
await browser.close();
