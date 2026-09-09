/* Leitor de ZIP em fluxo, sem instalar nada.
 *
 * Os arquivos da Receita são ZIP com um arquivo só dentro, deflate puro. Ler
 * em fluxo importa: o Estabelecimentos0 tem 2,2 GB compactado e não cabe na
 * memória desta máquina — nem descompactado em disco, junto com os outros.
 *
 * Cabeçalho local do ZIP: 30 bytes fixos, depois o nome e o campo extra. Os
 * dados começam em 30 + tamanho do nome + tamanho do extra.
 */
const fs = require("fs");
const zlib = require("zlib");

function abrirZip(caminho) {
  const fd = fs.openSync(caminho, "r");
  const cab = Buffer.alloc(30);
  fs.readSync(fd, cab, 0, 30, 0);

  if (cab.readUInt32LE(0) !== 0x04034b50) {
    fs.closeSync(fd);
    throw new Error("não é um ZIP: assinatura errada");
  }

  const metodo = cab.readUInt16LE(8);
  const tamNome = cab.readUInt16LE(26);
  const tamExtra = cab.readUInt16LE(28);

  const nome = Buffer.alloc(tamNome);
  fs.readSync(fd, nome, 0, tamNome, 30);
  fs.closeSync(fd);

  const inicio = 30 + tamNome + tamExtra;
  const bruto = fs.createReadStream(caminho, { start: inicio });

  return {
    nome: nome.toString("latin1"),
    metodo,
    fluxo: metodo === 8 ? bruto.pipe(zlib.createInflateRaw()) : bruto,
  };
}

/**
 * Percorre o CSV linha a linha, sem juntar o arquivo inteiro em memória.
 *
 * Os arquivos vêm em latin1 e com ponto e vírgula. Os campos de texto vêm
 * entre aspas; os numéricos, não. Como nenhum campo aqui contém ponto e
 * vírgula dentro das aspas, o corte simples basta — e um analisador completo
 * de CSV custaria caro em 60 milhões de linhas.
 */
async function porLinha(caminho, aoLer) {
  const { fluxo } = abrirZip(caminho);
  let sobra = "";
  let n = 0;

  for await (const pedaco of fluxo) {
    const texto = sobra + pedaco.toString("latin1");
    const linhas = texto.split("\n");
    sobra = linhas.pop();
    for (const l of linhas) {
      if (!l) continue;
      aoLer(l.endsWith("\r") ? l.slice(0, -1) : l, ++n);
    }
  }
  if (sobra) aoLer(sobra, ++n);
  return n;
}

/** Tira as aspas de um campo do CSV da Receita. */
const limpo = (s) => (s || "").replace(/^"|"$/g, "").trim();

module.exports = { abrirZip, porLinha, limpo };
