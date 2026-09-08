// Local manual UI fixture. Only exposes renderer/shared files and this fixture.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.writeHead(302, { Location: '/renderer/previous-review-preview.html' }); res.end(); return; }
  const relative = pathname === '/renderer/previous-review-preview.html' ? 'scripts/dev/previous-review-preview.html' : pathname.slice(1);
  if (req.method !== 'GET' || (!/^(renderer|shared)\//.test(relative) && relative !== 'scripts/dev/previous-review-preview.html')) {
    res.writeHead(404); res.end(); return;
  }
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': `${mime[path.extname(target)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
server.listen(Number(process.env.BAEFRAME_PREVIEW_PORT || 52915), '127.0.0.1', () => {
  process.stdout.write(`Previous review implementation preview: http://127.0.0.1:${server.address().port}/\n`);
});
