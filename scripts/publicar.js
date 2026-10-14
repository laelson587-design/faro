/* Monta a versão que vai para o ar, na pasta dist/.   npm run build
 *
 * O código daqui (comentado, com nomes claros) é o que se edita. O que o
 * navegador recebe é outro: ramos.js, app.js e ficha.js viram UM arquivo só,
 * passado pelo javascript-obfuscator — nomes trocados por códigos, textos
 * guardados embaralhados, sem um comentário. Juntar antes é obrigatório: os
 * três usam funções uns dos outros, e embaralhados separados cada um trocaria
 * os nomes do seu jeito, quebrando as ligações.
 *
 * O QUE ISSO É, DITO SEM EXAGERO: todo app que roda no navegador entrega o
 * código ao aparelho. Embaralhar não torna o código secreto, torna caro
 * entendê-lo e copiar a leitura e as ofertas. A proteção de verdade é o
 * repositório privado. Mesmo gerador do Connect Finance, adaptado.
 */
"use strict";
const fs = require("fs"), path = require("path");
const Ofuscador = require("javascript-obfuscator");

const RAIZ = path.join(__dirname, ".."), DIST = path.join(RAIZ, "dist");
const AVISO = `/*! Faro (c) ${new Date().getFullYear()}. Todos os direitos reservados. */\n`;
const SCRIPTS = ["ramos.js", "app.js", "ficha.js"];

const ler = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");
const gravar = (f, txt) => { fs.writeFileSync(path.join(DIST, f), txt); console.log(`  ${f.padEnd(14)} ${(Buffer.byteLength(txt) / 1024).toFixed(0).padStart(4)} KB`); };

const css = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{};])\s*/g, "$1").replace(/;}/g, "}").trim();
const html = (t) => t.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);
console.log("Montando dist/:");

/* A versão dos endereços vem do index.html (?v=N), para o navegador largar o
   arquivo antigo quando ela sobe — a mesma regra de sempre. */
const pagina = ler("index.html");
const versao = (/app\.js\?v=(\d+)/.exec(pagina) || [])[1] || "1";

const juntos = SCRIPTS.map(ler).join("\n;\n");
gravar("app.js", AVISO + Ofuscador.obfuscate(juntos, {
  compact: true, target: "browser", identifierNamesGenerator: "hexadecimal",
  renameGlobals: true, stringArray: true, stringArrayEncoding: ["base64"], stringArrayThreshold: 0.75,
  stringArrayRotate: true, stringArrayShuffle: true, stringArrayWrappersCount: 1,
  /* Lentos no celular por pouco ganho de embaralhamento. */
  controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false, debugProtection: false,
}).getObfuscatedCode());

gravar("estilo.css", AVISO + css(ler("estilo.css")));
const tags = SCRIPTS.map((f) => `<script src="${f}?v=${versao}"></script>`);
let saida = pagina;
for (const t of tags) {
  if (!saida.includes(t)) throw new Error(`index.html não tem ${t} — confira as versões.`);
  saida = saida.replace(t, t === tags[0] ? `<script src="app.js?v=${versao}"></script>` : "");
}
gravar("index.html", html(saida));
for (const f of ["manifest.json", "icone.svg", "icone-192.png", "icone-512.png"]) {
  fs.copyFileSync(path.join(RAIZ, f), path.join(DIST, f));
  console.log(`  ${f}`);
}
console.log("\nPronto.");
