const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = __dirname;
const pairs = [
  ['assets/styles.css.gz.b64', 'public/styles.css'],
  ['assets/admin.js.gz.b64', 'public/admin.js']
];

for (const [source, target] of pairs) {
  const src = path.join(root, source);
  const out = path.join(root, target);
  if (!fs.existsSync(src)) continue;
  const encoded = fs.readFileSync(src, 'utf8').trim();
  const decoded = zlib.gunzipSync(Buffer.from(encoded, 'base64'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, decoded);
}

console.log('Runtime assets hydrated.');
