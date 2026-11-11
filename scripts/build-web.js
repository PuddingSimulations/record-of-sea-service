// Copies the web files the native app needs into www/ (Capacitor's webDir). The app is plain HTML, so there is no bundler.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
const files = ['index.html', 'sign.html', 'dashboard.html', 'cloud.js', 'pdf-lib.min.js', 'AMSA_771.pdf', 'manifest.json', 'og-image.png', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
files.forEach(f => fs.copyFileSync(path.join(root, f), path.join(out, f)));
// The service worker is for the web version only; the native app already ships these files inside itself.
console.log('Copied ' + files.length + ' files to www/');
