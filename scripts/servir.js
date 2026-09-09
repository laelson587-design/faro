/* Servidor de teste. Só existe para o navegador poder buscar os arquivos —
   em produção isto é o GitHub Pages, e não há servidor nenhum. */
const http = require("http"), fs = require("fs"), path = require("path");
const RAIZ = path.join(__dirname, "..");
const TIPOS = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
                ".json": "application/json", ".txt": "text/plain; charset=iso-8859-1" };
http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const arq = path.join(RAIZ, p === "/" ? "index.html" : p);
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
    res.writeHead(404); return res.end("nao achei");
  }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream" });
  fs.createReadStream(arq).pipe(res);
}).listen(3010, () => console.log("http://localhost:3010"));
