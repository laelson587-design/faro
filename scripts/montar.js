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

/* Acima disto, o arquivo é fatiado por zona. São Paulo inteira dava 791 mil
   empresas de maquininha em 26 MB comprimidos — pesado de baixar e, pior,
   impossível de usar. Ninguém visita 791 mil portas; quem trabalha numa
   cidade grande trabalha uma zona.

   O limite é sobre O ARQUIVO QUE SE BAIXA, não sobre o tamanho da cidade.
   Medir pelo total do município fatiava Osasco — que tem 60 mil somando todos
   os ramos, mas cujo arquivo de maquininha são 3 MB e cabe inteiro. Fatiar sem
   precisar só acrescenta uma pergunta na tela e nenhum ganho. */
const FATIAR_ACIMA_DE_BYTES = 8 * 1024 * 1024;

/* As zonas saem do CEP, que é como o Brasil já divide o território — e, nas
   capitais, batem com o nome que as pessoas usam. Os dois primeiros dígitos
   bastam; três dariam cinquenta fatias e nenhuma legível.

   Cidade que não estiver aqui é fatiada assim mesmo, com o rótulo do próprio
   CEP: melhor "zona 13" do que um arquivo grande demais para abrir. */
const ZONAS = {
  // São Paulo capital
  "01": "Centro", "02": "Zona Norte", "03": "Zona Leste",
  "04": "Zona Sul", "05": "Zona Oeste", "08": "Extremo Leste",
};

function zonaDe(cep) {
  const c = String(cep || "").replace(/\D/g, "").padStart(8, "0");
  const dois = c.slice(0, 2);
  return { chave: dois, nome: ZONAS[dois] || `CEP ${dois}xxx` };
}

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
        // A conexão pode morrer no meio; sem este ouvinte o erro vira exceção
        // solta e derruba o processo em vez de virar uma nova tentativa.
        r.on("error", erro);
        r.pipe(saida);
        saida.on("finish", () => ok({ status: r.statusCode, esperado: total }));
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

/**
 * Baixa um lote, com duas proteções que custaram uma noite para aparecer.
 *
 * PRIMEIRA: baixa para um nome temporário e só renomeia no fim. Sem isso, uma
 * queda no meio deixava um zip pela metade com o nome certo — e a rodada
 * seguinte via que o arquivo "existia", pulava o download e tentava ler um
 * arquivo truncado. Falha silenciosa é pior que falha barulhenta.
 *
 * SEGUNDA: tenta de novo. Uma conexão de duas horas tropeça, e derrubar todo
 * o trabalho por um ECONNRESET é desperdício — foi exatamente o que aconteceu
 * no lote 3 da primeira noite.
 */
async function baixar(mes, arquivo, destino, tentativas = 5) {
  const rotulo = arquivo.padEnd(24);
  const temporario = destino + ".baixando";

  for (let n = 1; n <= tentativas; n++) {
    let ultimo = 0;
    try {
      const r = await pedir(`/public.php/webdav/${mes}/${arquivo}`, {
        para: temporario,
        aoAndar: (b, t) => {
          const pct = Math.floor((b / t) * 100);
          if (pct >= ultimo + 10) {
            ultimo = pct;
            process.stdout.write(`\r  ${rotulo} ${String(pct).padStart(3)}%${
              n > 1 ? ` (tentativa ${n})` : ""}`);
          }
        },
      });

      // Só aceita o que chegou inteiro. O servidor diz o tamanho; se o que
      // caiu no disco não bater, não presta.
      if (r.esperado && fs.statSync(temporario).size !== r.esperado) {
        throw new Error(`veio incompleto: ${fs.statSync(temporario).size} de ${r.esperado}`);
      }

      fs.renameSync(temporario, destino);
      process.stdout.write(`\r  ${rotulo} pronto (${(fs.statSync(destino).size / 1048576).toFixed(0)} MB)\n`);
      return;
    } catch (e) {
      if (fs.existsSync(temporario)) fs.unlinkSync(temporario);
      if (n === tentativas) throw e;
      const espera = n * 15;
      process.stdout.write(`\r  ${rotulo} caiu (${e.message}) · tenta de novo em ${espera}s\n`);
      await new Promise((r) => setTimeout(r, espera * 1000));
    }
  }
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

  /* -- refazer a saída sem baixar nada.
   *
   * Mudar como as profissões agrupam, ou como as cidades grandes são fatiadas,
   * não deveria custar sete GB de download de novo: o que já está em `dados/`
   * é a base bruta já filtrada, e basta reagrupá-la.
   *
   * Um mesmo estabelecimento aparece em mais de uma profissão (padaria serve
   * a maquininha e a energia), então a união passa por um Set — sem isso ele
   * entraria duas vezes ao voltar. */
  if (args.includes("--refatiar")) {
    console.log("\nRefazendo a partir de dados/, sem baixar nada");
    const porCidade = new Map();
    let n = 0;
    for (const arq of fs.readdirSync(SAIDA).filter((f) => f.endsWith(".txt"))) {
      const chave = arq.split("-").slice(0, 2).join("-");
      if (!porCidade.has(chave)) porCidade.set(chave, new Set());
      const alvo = porCidade.get(chave);
      for (const l of fs.readFileSync(path.join(SAIDA, arq), "latin1").split("\n")) {
        if (l) alvo.add(l);
      }
      n++;
    }
    for (const [k, v] of porCidade) porCidade.set(k, [...v]);
    const total = [...porCidade.values()].reduce((s, v) => s + v.length, 0);
    console.log(`  ${n} arquivos lidos · ${porCidade.size} cidades · ${total.toLocaleString("pt-BR")} empresas`);

    for (const f of fs.readdirSync(SAIDA)) fs.unlinkSync(path.join(SAIDA, f));
    return escrever(porCidade, municipios, cnaes, mes, Date.now(), total, 0);
  }

  /* -- os dez lotes, um por vez, e RETOMÁVEL.
   *
   * Uma noite de download não sobrevive a um notebook que dorme. Em vez de
   * lutar contra o Windows, o trabalho de cada lote é salvo assim que acaba:
   * rodar de novo pula o que já foi e continua. O recorte entra no nome do
   * arquivo parcial porque um progresso de "só SP" não serve para "Brasil". */
  const recorte = uf || (cidades.length ? cidades.join("_") : "br");
  const parcialDe = (i) => path.join(CACHE, `parcial-${recorte}-${i}.json`);

  let porCidade = new Map();
  const inicio = Date.now();
  let lidas = 0, guardadas = 0;

  /* Cada parcial é CUMULATIVO — contém tudo o que veio antes dele. Então
   * retomar é achar o mais adiantado que existe e continuar do seguinte.
   *
   * Percorrer lote a lote procurando o parcial de cada um, como eu fiz
   * primeiro, dava errado feio: com só o parcial do lote 2 em disco, o laço
   * reprocessava o 0 e o 1 e, ao salvar o progresso deles, APAGAVA o parcial
   * do 2. O trabalho da noite ia embora justamente na hora de retomá-lo. */
  let retomar = 0;
  for (let k = lotes.length - 1; k >= 0; k--) {
    if (fs.existsSync(parcialDe(lotes[k]))) {
      porCidade = new Map(JSON.parse(fs.readFileSync(parcialDe(lotes[k]), "utf8")));
      guardadas = [...porCidade.values()].reduce((s, v) => s + v.length, 0);
      retomar = k + 1;
      console.log(`\nRetomando: lotes ${lotes.slice(0, retomar).join(", ")} já feitos`
        + ` · ${guardadas.toLocaleString("pt-BR")} empresas acumuladas`);
      break;
    }
  }

  const falta = lotes.slice(retomar);
  console.log(`\nEstabelecimentos (faltam os lotes ${falta.join(", ") || "nenhum"})`);
  for (const i of falta) {
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

    /* Guarda o resultado DESTE lote antes de seguir. É o que permite fechar o
       notebook, o Windows dormir no meio, e amanhã continuar de onde parou em
       vez de recomeçar sete GB. Custa um arquivo temporário do tamanho do que
       já foi filtrado — muito menos que o zip que acabou de ser apagado. */
    fs.writeFileSync(parcialDe(i), JSON.stringify([...porCidade]));
    // Cada parcial já contém tudo o que veio antes, então o anterior vira
    // peso morto. Sem apagar, dez deles somariam mais de um giga.
    for (const j of lotes) {
      if (j !== i && fs.existsSync(parcialDe(j))) fs.unlinkSync(parcialDe(j));
    }
    console.log(`  ${" ".repeat(24)} +${(guardadas - antes).toLocaleString("pt-BR")} empresas · progresso salvo`);

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
  // Deu certo até aqui: o progresso parcial já não serve para nada, e ficaria
  // fazendo a próxima rodada pular lotes que precisam ser refeitos.
  for (const j of lotes) {
    if (fs.existsSync(parcialDe(j))) fs.unlinkSync(parcialDe(j));
  }
  return escrever(porCidade, municipios, cnaes, mes, inicio, guardadas, lidas);
})().catch((e) => { console.error("\nquebrou:", e.message); process.exit(1); });

/**
 * Escreve os arquivos de cidade e o indice.
 *
 * Vive numa funcao propria porque DOIS caminhos chegam aqui: a montagem
 * normal, que acabou de ler os lotes, e o --refatiar, que reagrupa o que ja
 * estava em dados/. Se fossem dois codigos, um dia sairiam arquivos
 * diferentes do mesmo dado — e ninguem descobriria por qual dos dois.
 */
function escrever(porCidade, municipios, cnaes, mes, inicio, guardadas, lidas) {
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

      // Decidido AQUI, por profissao: e o arquivo dela que a pessoa baixa.
      const fatiar = minhas.reduce((s, l) => s + l.length + 1, 0) > FATIAR_ACIMA_DE_BYTES;

      /* Cidade grande vira uma fatia por zona; cidade normal continua um
         arquivo só. A zona entra no nome do arquivo, então o app baixa
         exatamente a que a pessoa escolheu e mais nada. */
      const grupos = new Map();
      for (const l of minhas) {
        const z = fatiar ? zonaDe(l.split("\t")[5]) : { chave: "", nome: "" };
        if (!grupos.has(z.chave)) grupos.set(z.chave, { nome: z.nome, linhas: [] });
        grupos.get(z.chave).linhas.push(l);
      }

      const zonas = [];
      for (const [zc, g] of [...grupos].sort()) {
        const arquivo = `${chave}-${prof.id}${zc ? "-" + zc : ""}.txt`;
        const conteudo = g.linhas.join("\n");
        fs.writeFileSync(path.join(SAIDA, arquivo), conteudo, "latin1");
        zonas.push({
          zona: zc, nome: g.nome,
          empresas: g.linhas.length,
          bytes: Buffer.byteLength(conteudo, "latin1"),
        });
      }

      porProfissao[prof.id] = {
        empresas: minhas.length,
        bytes: zonas.reduce((s, z) => s + z.bytes, 0),
        // Só as cidades fatiadas trazem `zonas`; nas outras o app baixa o
        // arquivo único e não pergunta nada a mais.
        ...(fatiar ? { zonas } : {}),
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
}
