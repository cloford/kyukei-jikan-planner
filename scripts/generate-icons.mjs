import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// Draw the app's timeline/clock mark directly, without external image assets.
const colors = { green: [36, 107, 76, 255], paper: [246, 248, 244, 255], gold: [244, 213, 155, 255] };
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(bytes));
  return Buffer.concat([length, bytes, crc]);
}
function png(size, maskable) {
  const bytes = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.82 : 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = ((x + 0.5) / size - .5) / scale + .5;
    const v = ((y + 0.5) / size - .5) / scale + .5;
    let color = colors.green;
    // A compact timeline, with a gold break between two job bars.
    if (u >= .25 && u <= .75 && v >= .23 && v <= .77) color = colors.paper;
    if (u >= .33 && u <= .35 && v >= .31 && v <= .69) color = colors.green;
    if (u >= .41 && u <= .67 && v >= .32 && v <= .42) color = colors.green;
    if (u >= .41 && u <= .67 && v >= .45 && v <= .53) color = colors.gold;
    if (u >= .41 && u <= .67 && v >= .56 && v <= .67) color = colors.green;
    for (const row of [.34, .49, .63]) {
      if ((u - .34) ** 2 + (v - row) ** 2 < .025 ** 2) color = colors.green;
    }
    bytes.set(color, (y * size + x) * 4);
  }
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) bytes.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',header), chunk('IDAT',deflateSync(rows)), chunk('IEND',Buffer.alloc(0))]);
}
const directory = fileURLToPath(new URL('../dist/icons/', import.meta.url));
await mkdir(directory, { recursive: true });
for (const [name, size, maskable] of [['icon-192.png',192,false],['icon-512.png',512,false],['maskable-512.png',512,true]]) {
  await writeFile(directory + name, png(size, maskable));
}
