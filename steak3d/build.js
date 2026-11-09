// Bundles src/main.js (Three.js and all) and src/page.html into one standalone dist/index.html.
// No network needed to play it: no fonts, no images, no CDN.
const fs = require('fs'), path = require('path'), esbuild = require('esbuild');
const dir = __dirname;
const out = esbuild.buildSync({ entryPoints: [path.join(dir, 'src/main.js')], bundle: true, minify: true, write: false, format: 'iife', target: 'es2020', legalComments: 'none', logLevel: 'warning' });
let js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = fs.readFileSync(path.join(dir, 'src/page.html'), 'utf8');
const head = (page.match(/<title>[\s\S]*?<\/title>|<meta[^>]*>|<style>[\s\S]*?<\/style>/g) || []).join('\n');
const body = page.replace(/<title>[\s\S]*?<\/title>|<meta[^>]*>|<style>[\s\S]*?<\/style>/g, '');
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist/index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8">\n' + head + '\n</head><body>' + body + '<script>' + js + '</script></body></html>');
console.log('built dist/index.html', (fs.statSync(path.join(dir, 'dist/index.html')).size / 1024).toFixed(0) + ' KB');
