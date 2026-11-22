// Gera o pacote OTA: um unico HTML com CSS e JS embutidos + version.json
const fs = require('fs');
const out = process.argv[2] || 'ota-site';
let html = fs.readFileSync('www/index.html', 'utf8');
const css = fs.readFileSync('www/styles.css', 'utf8');
const js = fs.readFileSync('www/app.js', 'utf8').replace(/<\/script/gi, '<\\/script');

const linkTag = '<link rel="stylesheet" href="styles.css" />';
const scriptTag = `<script>if(!window.__MK_OTA){document.write('<script src="app.js"><\\/script>');}</script>`;
if (!html.includes(linkTag) || !html.includes(scriptTag)) {
  console.error('index.html nao tem as tags esperadas (styles.css / app.js)');
  process.exit(1);
}
html = html.replace(linkTag, () => '<style>' + css + '</style>').replace(scriptTag, () => '<script>' + js + '</script>');

const built = Math.floor(Date.now() / 1000);
const version = '1.0.' + (process.env.RUN_NUM || built);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(out + '/bundle.json', JSON.stringify({ version, built, html }));
fs.writeFileSync(out + '/version.json', JSON.stringify({ version, built }));
console.log('OTA', version, built, Math.round(html.length / 1024) + ' KB');
