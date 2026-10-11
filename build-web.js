// Copia los archivos web a www/ para Capacitor
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
fs.mkdirSync(path.join(out, 'templates'), { recursive: true });
for (const f of ['index.html', 'app.js', 'parser.js', 'reportparse.js', 'ocrsmart.js', 'pcocr.js', 'pdfgen.js', 'docscan.js', 'layout.js', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(__dirname, f), path.join(out, f));
for (const f of fs.readdirSync(path.join(__dirname, 'lib'))) fs.copyFileSync(path.join(__dirname, 'lib', f), path.join(out, 'lib', f));
for (const f of ['cover.jpeg', 'sheet.jpeg']) fs.copyFileSync(path.join(__dirname, 'templates', f), path.join(out, 'templates', f));
console.log('www listo');
