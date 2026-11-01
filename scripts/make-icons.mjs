// Regenerates public/icons/*.png (D33): a 16×16 pixel-art grass block with a fast-forward
// mark, scaled with nearest-neighbour so every size stays crisp. Original art, no game assets.
// Usage: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PALETTE = {
  K: [26, 18, 11], // outline
  G: [106, 184, 58], // grass light
  g: [74, 138, 38], // grass dark
  D: [138, 95, 60], // dirt
  d: [102, 68, 42], // dirt dark
  s: [163, 118, 80], // dirt speck
  W: [255, 255, 255], // mark
  S: [61, 40, 23], // mark shadow
};

// Rows 1–4 grass with a dripping edge; the rest dirt. The mark is added below.
const BASE = [
  'KKKKKKKKKKKKKKKK',
  'KGGgGGGGgGGGGgGK',
  'KGgGGGgGGGgGGGGK',
  'KgGGgGGGGgGGgGGK',
  'KGgDgGgDDgGgDgGK',
  'KDgDDdgDDsDgDDdK',
  'KDDsDDDDdDDDDsDK',
  'KdDDDDDDDDDdDDDK',
  'KDDDDsDDDDDDDDDK',
  'KDsDDDDDDDdDDDsK',
  'KDDDDDDDDDDDDDDK',
  'KDDdDDDDsDDDDDDK',
  'KDDDDDDDDDDDDdDK',
  'KsDDDDdDDDDsDDDK',
  'KDDDDDDDDDDDDDDK',
  'KKKKKKKKKKKKKKKK',
].map((row) => [...row]);

// Two right-pointing triangles (fast-forward), rows 6–12, each with a 1px drop shadow.
const WIDTHS = [1, 2, 3, 4, 3, 2, 1];
const mark = new Set();
for (const startCol of [4, 8])
  WIDTHS.forEach((w, i) => {
    for (let c = 0; c < w; c++) mark.add(`${String(6 + i)},${String(startCol + c)}`);
  });
for (const key of mark) {
  const [r, c] = key.split(',').map(Number);
  const shadow = `${String(r + 1)},${String(c + 1)}`;
  if (!mark.has(shadow) && BASE[r + 1][c + 1] !== 'K') BASE[r + 1][c + 1] = 'S';
}
for (const key of mark) {
  const [r, c] = key.split(',').map(Number);
  BASE[r][c] = 'W';
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** `pad` transparent pixels surround the art (Chrome Web Store wants 96px art in 128px). */
function png(size, grey, pad = 0) {
  const scale = (size - pad * 2) / 16;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [ay, ax] = [y - pad, x - pad];
      if (ay < 0 || ax < 0 || ay >= size - pad * 2 || ax >= size - pad * 2) continue;
      let [r, g, b] = PALETTE[BASE[Math.floor(ay / scale)][Math.floor(ax / scale)]];
      if (grey) r = g = b = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      raw.set([r, g, b, 255], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../public/icons/${String(size)}.png`, import.meta.url), png(size, false));
  writeFileSync(
    new URL(`../public/icons/${String(size)}-disabled.png`, import.meta.url),
    png(size, true),
  );
}
mkdirSync(new URL('../docs/store/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/store/store-icon-128.png', import.meta.url), png(128, false, 16));
console.log('icons written');
