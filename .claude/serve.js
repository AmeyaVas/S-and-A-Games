const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2]), port = Number(process.argv[3] || 4173);
const TYPES = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
  '.md':'text/plain; charset=utf-8', '.json':'application/json',
  '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif',
  '.svg':'image/svg+xml', '.ico':'image/x-icon'};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if(p.endsWith('/')) p += 'index.html';
  const file = path.resolve(path.join(root, p));
  if(!file.startsWith(root)){ res.writeHead(403).end('no'); return; }
  fs.readFile(file, (err, buf) => {
    if(err){ res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'});
    res.end(buf);
  });
}).listen(port, () => console.log('serving ' + root + ' on http://localhost:' + port));
