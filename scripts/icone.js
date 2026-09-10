/* Gera os PNGs do ícone a partir de `icone.svg`.
 *
 * A versão anterior deste script desenhava o ícone pixel a pixel e escrevia o
 * PNG na mão, com zlib, para não depender de biblioteca nenhuma. Deu certo
 * enquanto o desenho era um balão de formas simples; um anel de três arcos com
 * pontas arredondadas seria trigonometria demais para pouco retorno.
 *
 * Agora a fonte da verdade é o SVG, que é texto e entra no git como qualquer
 * outro arquivo, e quem rasteriza é o Chrome — que já está na máquina de quem
 * mexe no projeto. Continua sem instalar nada.
 *
 *   node scripts/icone.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const RAIZ = path.join(__dirname, "..");
const PORTA = 8799;
const DEPURACAO = 9299;
const TAMANHOS = [192, 512];

const CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function acharChrome() {
  const achado = CHROMES.find((c) => fs.existsSync(c));
  if (!achado) throw new Error("não achei o Chrome. Ajuste a lista CHROMES no topo deste arquivo.");
  return achado;
}

/** Página mínima com o SVG no tamanho pedido, sem margem nenhuma. */
function pagina(lado) {
  const svg = fs.readFileSync(path.join(RAIZ, "icone.svg"), "utf8")
    .replace(/width="\d+"/, `width="${lado}"`)
    .replace(/height="\d+"/, `height="${lado}"`);
  return `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}
      svg{display:block}</style>${svg}`;
}

function servir() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const lado = Number((req.url.match(/\d+/) || [])[0]) || 512;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pagina(lado));
    });
    s.listen(PORTA, () => ok(s));
  });
}

async function alvoDaPagina() {
  for (let i = 0; i < 40; i++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${DEPURACAO}/json/list`)).json();
      const p = lista.find((t) => t.type === "page");
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) { /* ainda subindo */ }
    await esperar(250);
  }
  throw new Error("o Chrome não abriu a porta de depuração");
}

function conectar(url) {
  return new Promise((ok, falha) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pendentes = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pendentes.has(m.id)) {
        const { r, f } = pendentes.get(m.id);
        pendentes.delete(m.id);
        m.error ? f(new Error(JSON.stringify(m.error))) : r(m.result);
      }
    };
    ws.onerror = falha;
    ws.onopen = () => ok({
      manda: (metodo, params = {}) => new Promise((r, f) => {
        const meu = ++id;
        pendentes.set(meu, { r, f });
        ws.send(JSON.stringify({ id: meu, method: metodo, params }));
      }),
      fechar: () => ws.close(),
    });
  });
}

(async () => {
  const servidor = await servir();
  const perfil = path.join(RAIZ, ".chrome-icone");
  fs.rmSync(perfil, { recursive: true, force: true });

  const chrome = spawn(acharChrome(), [
    "--headless=new", "--remote-debugging-port=" + DEPURACAO,
    "--user-data-dir=" + perfil, "--no-first-run", "--disable-gpu", "about:blank",
  ], { stdio: "ignore" });

  const cdp = await conectar(await alvoDaPagina());
  await cdp.manda("Page.enable");

  for (const lado of TAMANHOS) {
    await cdp.manda("Emulation.setDeviceMetricsOverride",
      { width: lado, height: lado, deviceScaleFactor: 1, mobile: false });
    await cdp.manda("Page.navigate", { url: `http://127.0.0.1:${PORTA}/${lado}` });
    await esperar(400);

    const foto = await cdp.manda("Page.captureScreenshot", { format: "png" });
    const destino = path.join(RAIZ, `icone-${lado}.png`);
    fs.writeFileSync(destino, Buffer.from(foto.data, "base64"));
    console.log("gravado: " + path.basename(destino) + "  (" + lado + "×" + lado + ")");
  }

  cdp.fechar();
  chrome.kill();
  servidor.close();
  // O Chrome solta o perfil um instante depois do kill; se ainda estiver preso,
  // fica para a próxima execução, que começa apagando.
  try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
