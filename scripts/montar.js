/* Monta os arquivos de cidade a partir da base aberta da Receita Federal.
 *
 * Roda UMA VEZ, de madrugada. Depois disso o app não precisa de servidor
 * nenhum: cada cidade é um arquivo de texto que o navegador baixa e pesquisa
 * sozinho.
 *
 *   node scripts/montar.js                    # Brasil inteiro
 *   node scripts/montar.js 6789 7107          # só estas cidades
 *   node scripts/montar.js --uf SP            # só um estado
 *   node scripts/montar.js --lotes 1,9        # só estes lotes (para experimentar)
 *
 * BAIXA UM ARQUIVO POR VEZ E APAGA ANTES DO PRÓXIMO. São dez arquivos de
 * Estabelecimentos somando quase 7 GB, e a máquina onde isto nasceu tinha 12
 * GB livres. Guardar todos antes de processar não caberia — e não precisa,
 * porque cada um é lido em fluxo e só o que passa no filtro fica.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const { porLinha, limpo } = require(path.join(__dirname, "zip.js"));
const { TODOS_OS_PREFIXOS, PROFISSOES } = require(path.join(__dirname, "..", "ramos.js"));

const RAIZ = path.join(__dirname, "..");
const CACHE = path.join(RAIZ, ".cache");
const SAIDA = path.join(RAIZ, "dados");

/* O share público da Receita, servido por WebDAV. O token é a "senha" do
   share — público, e é assim que a Receita publica. */
const SERVIDOR = "arquivos.receitafederal.gov.br";
const SHARE = "YggdBLfdninEJX9";

/* 02 = ativa. Empresa baixada não recebe visita. */
const ATIVA = "02";

/* Colunas do arquivo Estabelecimentos, conferidas na própria base. */
const COL = {
  CNPJ: 0, ORDEM: 1, DV: 2, FANTASIA: 4, SITUACAO: 5, INICIO: 10, CNAE: 11,
  TIPO_LOGR: 13, LOGRADOURO: 14, NUMERO: 15, BAIRRO: 17, CEP: 18, UF: 19,
  MUNICIPIO: 20, DDD: 21, TEL: 22, EMAIL: 27,
};

// ------------------------------------------------------------------ rede

function pedir(caminho, opcoes = {}) {
  return new Promise((ok, erro) => {
    const req = https.request({
      host: SERVIDOR, path: caminho, method: opcoes.metodo || "GET",
      auth: SHARE + ":",
      headers: { "User-Agent": "Rota/1.0", ...(opcoes.headers || {}) },
    }, (r) => {
      if (opcoes.para) {
        const saida = fs.createWriteStream(opcoes.para);
        let baixado = 0;
        const total = Number(r.headers["content-length"]) || 0;
        r.on("data", (d) => {
          baixado += d.length;
          if (total && opcoes.aoAndar) opcoes.aoAndar(baixado, total);
        });
        r.pipe(saida);
        saida.on("finish", () => ok({ status: r.statusCode }));
        saida.on("error", erro);
        return;
      }
      let corpo = "";
      r.on("data", (d) => (corpo += d));
      r.on("end", () => ok({ status: r.statusCode, corpo }));
    });
    req.on("error", erro);
    if (opcoes.corpo) req.write(opcoes.corpo);
    req.end();
  });
}

/** O mês mais recente publicado. A Receita atualiza uma vez por mês. */
async function mesMaisNovo() {
  const r = await pedir("/public.php/webdav/", {
    metodo: "PROPFIND", headers: { Depth: "1" },
  });
  const meses = [...r.corpo.matchAll(/webdav\/(\d{4}-\d{2})\//g)].map((m) => m[1]);
  if (!meses.length) throw new Error("não consegui listar os meses do repositório");
  return [...new Set(meses)].sort().pop();
}

async function baixar(mes, arquivo, destino) {
  const rotulo = arquivo.padEnd(24);
  let ultimo = 0;
  await pedir(`/public.php/webdav/${mes}/${arquivo}`, {
    para: destino,
    aoAndar: (b, t) => {
      const pct = Math.floor((b / t) * 100);
      if (pct >= ultimo + 10) {
        ultimo = pct;
        process.stdout.write(`\r  ${rotulo} ${String(pct).padStart(3)}%`);
      }
    },
  });
  process.stdout.write(`\r  ${rotulo} pronto (${(fs.statSync(destino).size / 1048576).toFixed(0)} MB)\n`);
}

// ----------------------------------------------------------------- filtro

const ehAlvo = (cnae) => {
  const c = String(cnae || "").padStart(7, "0");
  return TODOS_OS_PREFIXOS.some((p) => c.startsWith(p));
};

/** Guarda só o que serve para bater na porta. Nada de sócio, nada de CPF. */
function linhaDeSaida(c) {
  return [
    c[COL.CNPJ] + c[COL.ORDEM] + c[COL.DV],
    c[COL.FANTASIA],
    c[COL.CNAE],
    [c[COL.TIPO_LOGR], c[COL.LOGRADOURO], c[COL.NUMERO]].filter(Boolean).join(" "),
    c[COL.BAIRRO],
    c[COL.CEP],
    c[COL.DDD] && c[COL.TEL] ? c[COL.DDD] + c[COL.TEL] : "",
    c[COL.INICIO],
  ].join("\t");
}

// ------------------------------------------------------------------ tudo

(async () => {
  const args = process.argv.slice(2);
  const iUf = args.indexOf("--uf");
  const uf = iUf >= 0 ? String(args[iUf + 1] || "").toUpperCase() : null;
  const iLotes = args.indexOf("--lotes");
  const lotes = iLotes >= 0
    ? String(args[iLotes + 1] || "").split(",").map(Number).filter((n) => n >= 0 && n <= 9)
    : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  // Os números soltos são cidades — menos os que foram consumidos por --uf/--lotes.
  const consumidos = new Set([args[iUf + 1], args[iLotes + 1]]);
  const cidades = args.filter((a) => /^\d+$/.test(a) && !consumidos.has(a));

  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(SAIDA, { recursive: true });

  const mes = await mesMaisNovo();
  console.log(`Base da Receita: ${mes}`);
  console.log(uf ? `Recorte: ${uf}` : cidades.length ? `Recorte: ${cidades.join(", ")}` : "Recorte: Brasil inteiro");
  console.log("");

  // -- tabelas pequenas
  console.log("Tabelas de apoio");
  for (const t of ["Municipios", "Cnaes"]) {
    const destino = path.join(CACHE, t + ".zip");
    if (!fs.existsSync(destino)) await baixar(mes, t + ".zip", destino);
    else console.log(`  ${t.padEnd(24)} já estava aqui`);
  }

  const municipios = new Map();
  await porLinha(path.join(CACHE, "Municipios.zip"), (l) => {
    const [cod, nome] = l.split(";").map(limpo);
    municipios.set(cod.replace(/^0+/, ""), nome);
  });

  const cnaes = new Map();
  await porLinha(path.join(CACHE, "Cnaes.zip"), (l) => {
    const [cod, nome] = l.split(";").map(limpo);
    cnaes.set(cod, nome);
  });

  // -- os dez lotes, um por vez
  const porCidade = new Map();
  const inicio = Date.now();
  let lidas = 0, guardadas = 0;

  console.log(`\nEstabelecimentos (lotes ${lotes.join(", ")})`);
  for (const i of lotes) {
    const arquivo = `Estabelecimentos${i}.zip`;
    const destino = path.join(CACHE, arquivo);

    if (!fs.existsSync(destino)) await baixar(mes, arquivo, destino);
    else console.log(`  ${arquivo.padEnd(24)} já estava aqui`);

    const antes = guardadas;
    await porLinha(destino, (l) => {
      lidas++;
      const c = l.split(";").map(limpo);
      if (c.length < 28) return;
      if (uf && c[COL.UF] !== uf) return;
      if (cidades.length && !cidades.includes(c[COL.MUNICIPIO])) return;
      if (c[COL.SITUACAO] !== ATIVA) return;
      if (!ehAlvo(c[COL.CNAE])) return;

      const chave = c[COL.UF] + "-" + c[COL.MUNICIPIO];
      if (!porCidade.has(chave)) porCidade.set(chave, []);
      porCidade.get(chave).push(linhaDeSaida(c));
      guardadas++;
    });

    console.log(`  ${" ".repeat(24)} +${(guardadas - antes).toLocaleString("pt-BR")} empresas`);

    // Apaga antes do próximo: sete GB não cabem juntos, e não precisam.
    if (!process.env.GUARDAR_LOTES) fs.unlinkSync(destino);
  }

  /* -- escreve: UM ARQUIVO POR CIDADE **E POR PROFISSÃO**.
   *
   * Com todos os ramos juntos, São Paulo capital dava 24 MB comprimidos —
   * ninguém baixa isso no 4G para bater porta. Separado, quem vende
   * maquininha não carrega transportadora nem construtora, e o arquivo dele
   * cai para um quinto.
   *
   * As profissões se sobrepõem (padaria serve a maquininha e a energia), então
   * o total em disco cresce um pouco. Vale: o que importa é o tamanho de UM
   * download, não a soma de todos. */
  console.log("\nEscrevendo");
  const indice = [];
  for (const [chave, linhas] of [...porCidade].sort()) {
    const [uf2, cod] = chave.split("-");
    const nome = municipios.get(cod.replace(/^0+/, "")) || cod;
    const porProfissao = {};

    for (const prof of PROFISSOES) {
      if (prof.id === "todos") continue;   // "todos" é escolher outra, não baixar tudo
      const minhas = linhas.filter((l) => {
        const c = l.split("\t")[2].padStart(7, "0");
        return prof.prefixos.some((p) => c.startsWith(p));
      });
      if (!minhas.length) continue;

      const arquivo = `${chave}-${prof.id}.txt`;
      const conteudo = minhas.join("\n");
      fs.writeFileSync(path.join(SAIDA, arquivo), conteudo, "latin1");
      porProfissao[prof.id] = {
        empresas: minhas.length,
        bytes: Buffer.byteLength(conteudo, "latin1"),
      };
    }

    if (!Object.keys(porProfissao).length) continue;
    indice.push({
      uf: uf2, cod, nome,
      empresas: linhas.length,
      bytes: Object.values(porProfissao).reduce((s, p) => s + p.bytes, 0),
      profissoes: porProfissao,
    });
  }

  indice.sort((a, b) => b.empresas - a.empresas);
  fs.writeFileSync(path.join(SAIDA, "cidades.json"),
    JSON.stringify({ base: mes, montadoEm: new Date().toISOString(), cidades: indice }));

  // Os nomes dos CNAEs vão à parte: repetem em toda linha e seriam metade do
  // arquivo se fossem junto. O app junta os dois na hora de mostrar.
  const usados = {};
  for (const linhas of porCidade.values()) {
    for (const l of linhas) {
      const cnae = l.split("\t")[2];
      if (!usados[cnae]) usados[cnae] = cnaes.get(cnae) || "";
    }
  }
  fs.writeFileSync(path.join(SAIDA, "cnaes.json"), JSON.stringify(usados));

  const seg = ((Date.now() - inicio) / 1000).toFixed(0);
  const totalBytes = indice.reduce((s, c) => s + c.bytes, 0);
  console.log(`\n  ${indice.length.toLocaleString("pt-BR")} cidades · ${guardadas.toLocaleString("pt-BR")} empresas`);
  console.log(`  ${(totalBytes / 1048576).toFixed(1)} MB em disco (o servidor entrega comprimido, ~4x menor)`);
  console.log(`  ${lidas.toLocaleString("pt-BR")} linhas lidas em ${seg}s`);
  console.log(`\n  maiores cidades:`);
  for (const c of indice.slice(0, 5)) {
    console.log(`    ${c.nome.padEnd(22)} ${String(c.empresas).padStart(7)} empresas · ${(c.bytes / 1024).toFixed(0)} KB`);
  }
})().catch((e) => { console.error("\nquebrou:", e.message); process.exit(1); });
