import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['index.html', 'style.css', 'app.js', 'calculation.js', 'pwa.js', 'manifest.webmanifest',
  ...(await readdir(path.join(root, 'dist/icons'))).filter((file) => file.endsWith('.png')).sort().map((file) => `icons/${file}`)];
const assets = await Promise.all(files.map(async (file) => ({ path: '/' + file,
  sha256: createHash('sha256').update(await readFile(path.join(root, 'dist', file))).digest('hex') })));
const template = await readFile(path.join(root, 'scripts/sw-template.js'), 'utf8');
const version = createHash('sha256').update(JSON.stringify(assets)).update(template).digest('hex').slice(0, 20);
const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
const worker = template.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets, null, 2))
  .replace('__INDEX_HTML__', JSON.stringify(html));
if (process.argv.includes('--check')) {
  if (await readFile(path.join(root, 'dist/sw.js'), 'utf8') !== worker) throw new Error('Run node scripts/build-pwa.mjs before publishing');
} else await writeFile(path.join(root, 'dist/sw.js'), worker);
console.log(`PWA app shell ${version}: ${assets.length} files`);
