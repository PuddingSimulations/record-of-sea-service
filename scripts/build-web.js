// Builds www/ (Capacitor's webDir) for the native apps: the app from app/ plus the shared files, flattened into one folder.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
html = html.replace(/(["'])\.\.\//g, '$1');   // ../cloud.js -> cloud.js, since everything sits in one folder here
fs.writeFileSync(path.join(out, 'index.html'), html);
['sign.html', 'dashboard.html', 'cloud.js', 'pdf-lib.min.js', 'AMSA_771.pdf', 'og-image.png', 'icon-180.png', 'icon-192.png', 'icon-512.png'].forEach(f => fs.copyFileSync(path.join(root, f), path.join(out, f)));
fs.copyFileSync(path.join(root, 'app', 'manifest.json'), path.join(out, 'manifest.json'));
console.log('Built www/ for the native app');
