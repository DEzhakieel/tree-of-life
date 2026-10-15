const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = 'C:\\Users\\LENOVO\\Downloads\\fractallife2\\apps\\web\\dist';
const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'};
const server = http.createServer((req, res) => {
  let fp = req.url === '/' ? '/index.html' : req.url;
  fp = path.join(dir, fp);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + req.url); return; }
    res.writeHead(200, {'Content-Type': mime[path.extname(fp)] || 'application/octet-stream'});
    res.end(data);
  });
});
server.listen(3000, '0.0.0.0', () => { console.log('Preview server on http://localhost:3000'); });
