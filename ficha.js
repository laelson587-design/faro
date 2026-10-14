/* A ficha da empresa — o Acervo, dentro do Faro.
 *
 * O roteiro diz QUAIS empresas visitar; a ficha diz O QUE É esta, antes de
 * bater na porta: se está ativa, quem responde por ela, o que o cadastro quer
 * dizer e o que cabe oferecer. Antes isso exigia copiar o CNPJ e colar no
 * Acervo — que só rodava com o notebook ligado e na mesma wi-fi. Na rua, a
 * segunda metade do trabalho não existia.
 *
 * Continua sem servidor: o celular pergunta direto às fontes públicas, que
 * aceitam ser chamadas pelo navegador (conferido em 13/10/2026 — BrasilAPI,
 * Minha Receita e CNPJ.ws aceitam; ReceitaWS e o cadastro de fornecedores do
 * governo recusam, e por isso não estão aqui). Nada é guardado: a ficha vive
 * enquanto está na tela. Sanções ficam para a versão com servidor, porque a
 * chave do Portal da Transparência no navegador seria chave pública.
 *
 * Os blocos vieram do `blocos.js` do Acervo. A tabela de ramos é a mesma de
 * `ramos.js` — uma só, a do roteiro e a da ficha.
 */

/* ---------------------------------------------------------------- fontes */

/* As duas espelham a mesma base da Receita. Alternar entre elas divide o peso,
   e a que falhar passa a vez para a outra. */
const FONTES_FICHA = [
  { id: "brasilapi", rotulo: "BrasilAPI", url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}` },
  { id: "minhareceita", rotulo: "Minha Receita", url: (c) => `https://minhareceita.org/${c}` },
];
let proximaFonte = 0;
const castigoFonte = new Map();   // fonte que disse "devagar" (429) descansa um minuto

/* AbortSignal.timeout só existe do iOS 16 em diante; assim funciona antes. */
async function buscarJson(url, ms = 15000) {
  const ctl = new AbortController();
  const relogio = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: ctl.signal });
    return { status: r.status, corpo: r.ok ? await r.json() : null };
  } finally {
    clearTimeout(relogio);
  }
}

/* 404 não tenta a segunda: CNPJ que não existe não existe nas duas. 429 e
   erro de servidor tentam, porque o problema é de quem responde. */
async function consultarCadastro(cnpj) {
  const ordem = [0, 1].map((i) => FONTES_FICHA[(proximaFonte + i) % FONTES_FICHA.length]);
  proximaFonte = (proximaFonte + 1) % FONTES_FICHA.length;
  const livres = ordem.filter((f) => (castigoFonte.get(f.id) || 0) < Date.now());

  for (const f of livres.length ? livres : ordem) {
    try {
      const { status, corpo } = await buscarJson(f.url(cnpj), 8000);   // lenta? passa a vez cedo
      if (status === 404) throw new Error("Este CNPJ não foi encontrado na Receita.");
      if (status === 429) { castigoFonte.set(f.id, Date.now() + 60000); continue; }
      if (!corpo) continue;
      return normalizar(corpo, f.rotulo);
    } catch (e) {
      if (/não foi encontrado/.test(e.message)) throw e;
    }
  }
  throw new Error(navigator.onLine === false
    ? "Sem internet. A ficha precisa de sinal; o roteiro continua funcionando."
    : "As fontes da Receita não responderam agora. Tente daqui a pouco.");
}

/* As fontes divergem em detalhes; daqui para frente é um formato só. */
function normalizar(b, fonte) {
  return {
    razao: b.razao_social || null,
    fantasia: b.nome_fantasia || null,
    situacao: b.descricao_situacao_cadastral || null,
    situacaoDesde: b.data_situacao_cadastral || null,
    motivoSituacao: b.descricao_motivo_situacao_cadastral &&
      b.descricao_motivo_situacao_cadastral !== "SEM MOTIVO" ? b.descricao_motivo_situacao_cadastral : null,
    situacaoEspecial: b.situacao_especial || null,
    abertura: b.data_inicio_atividade || null,
    porte: b.porte || b.descricao_porte || null,
    capital: b.capital_social ?? null,
    mei: b.opcao_pelo_mei === true,
    simples: b.opcao_pelo_simples === true,
    natureza: b.natureza_juridica || null,
    cnae: b.cnae_fiscal || null,
    atividade: b.cnae_fiscal_descricao || null,
    outras: Array.isArray(b.cnaes_secundarios) ? b.cnaes_secundarios.filter((c) => c && c.codigo) : [],
    telefone: telefoneDeVerdade(b.ddd_telefone_1) || telefoneDeVerdade(b.ddd_telefone_2),
    email: String(b.email || "").trim().toLowerCase() || null,
    endereco: [[b.descricao_tipo_de_logradouro, b.logradouro].filter(Boolean).join(" "), b.numero,
      b.complemento].filter(Boolean).join(", "),
    bairro: b.bairro || null,
    municipio: b.municipio || null,
    uf: b.uf || null,
    cep: String(b.cep || "").replace(/\D/g, "") || null,
    qsa: Array.isArray(b.qsa) ? b.qsa : [],
    fonte,
    em: new Date(),
  };
}

/* "(0000) 0000-0000" e "00000000" são preenchimento, não telefone. */
function telefoneDeVerdade(bruto) {
  for (const parte of String(bruto || "").split("/")) {
    const d = parte.replace(/\D/g, "");
    if (d.length >= 10 && !/^0+$/.test(d)) return d;
  }
  return null;
}

/* BrasilAPI e Minha Receita tiram o e-mail antes de entregar — vinha vazio
   até para a Petrobras. A CNPJ.ws não tira, mas aceita poucas consultas por
   minuto: por isso só é chamada quando faltou. */
async function buscarContatoExtra(cnpj) {
  const { status, corpo } = await buscarJson(`https://publica.cnpj.ws/cnpj/${cnpj}`, 20000);
  if (status === 429) throw new Error("A fonte do e-mail pediu um minuto de pausa. Abra a ficha de novo daqui a pouco.");
  if (!corpo) throw new Error("A fonte do e-mail não respondeu.");
  const e = corpo.estabelecimento || {};
  return {
    telefone: telefoneDeVerdade([e.ddd1, e.telefone1].filter(Boolean).join("")),
    email: String(e.email || "").trim().toLowerCase() || null,
  };
}

/* ------------------------------------------------------------- ajudinhas */

/* Sem `new Date(iso)`: em horário de Brasília o fuso joga a data para o dia
   anterior, e um aniversário de empresa vira "ontem". */
function anosDesde(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  const h = new Date();
  let anos = h.getFullYear() - +m[1];
  if (h.getMonth() + 1 < +m[2] || (h.getMonth() + 1 === +m[2] && h.getDate() < +m[3])) anos--;
  return anos;
}
const dataBR = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const reais = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const minusculo = (s) => String(s || "").toLowerCase();

/* ---------------------------------------------------------------- blocos */

/* A leitura não consulta nada: é o que os campos permitem concluir para quem
   vai decidir — vender a prazo, dar crédito, bater na porta. É a parte que
   não vem junto com o dado. */
function leitura(d) {
  const pontos = [];
  const natureza = String(d.natureza || "");
  const anos = anosDesde(d.abertura);

  if (d.situacao && !/ATIVA/i.test(d.situacao)) {
    pontos.push({ tom: "pare", titulo: `Cadastro ${minusculo(d.situacao)}`,
      texto: "Não emite nota fiscal e não contrata com órgão público. Faturar contra esse CNPJ é criar " +
        "uma cobrança difícil de executar depois." + (d.motivoSituacao ? ` Motivo registrado: ${minusculo(d.motivoSituacao)}.` : "") });
  }
  if (d.situacaoEspecial) {
    pontos.push({ tom: "pare", titulo: d.situacaoEspecial,
      texto: "Situação especial registrada na Receita. É a informação mais importante desta ficha — confirme antes de qualquer combinado." });
  }
  if (/individual/i.test(natureza) || d.mei) {
    pontos.push({ tom: "atencao", titulo: "Não há separação entre a empresa e a pessoa",
      texto: "Em empresário individual e MEI o titular responde com o patrimônio pessoal. Existe uma pessoa " +
        "atrás da dívida, mas nenhum capital social garantindo nada, e o negócio acaba junto com ela." });
  } else if (/limitada/i.test(natureza)) {
    pontos.push({ tom: "neutro", titulo: "Responsabilidade limitada ao capital",
      texto: "O patrimônio dos sócios está separado do da empresa. Se der errado, a garantia para no capital " +
        "social — o número declarado, não o dinheiro em caixa." });
  } else if (/an[ôo]nima/i.test(natureza)) {
    pontos.push({ tom: "neutro", titulo: "Sociedade anônima",
      texto: "Responsabilidade limitada ao valor das ações. Costuma publicar balanço — dá para achar número de verdade sobre ela." });
  }
  if (d.mei) {
    pontos.push({ tom: "atencao", titulo: "MEI tem teto de faturamento",
      texto: "Se o movimento na porta parecer maior que o teto anual do MEI, ou ela está prestes a ser " +
        "desenquadrada, ou já fatura fora do enquadramento." });
  }
  if (anos !== null && anos < 2) {
    pontos.push({ tom: "atencao", titulo: `Empresa nova — ${anos < 1 ? "menos de um ano" : "menos de dois anos"}`,
      texto: "A maior parte das empresas que fecham, fecham nos primeiros anos. Não é motivo para não vender; " +
        "é motivo para não vender a prazo longo na primeira compra." });
  } else if (anos !== null && anos >= 10) {
    pontos.push({ tom: "bom", titulo: `${anos} anos de casa`,
      texto: "Atravessou crise e pandemia com o cadastro em pé. É o sinal mais barato de que o negócio se sustenta." });
  }
  if (d.outras.length >= 5) {
    pontos.push({ tom: "neutro", titulo: `${d.outras.length} atividades além da principal`,
      texto: "Ou o negócio faz mesmo várias coisas, ou o contador registrou tudo na abertura. Confirme na visita " +
        "o que ela de fato faz — muda o que se oferece." });
  }
  return pontos;
}

/* O que cabe oferecer. No Acervo isto ficava escondido atrás do modo
   vendedor, porque lá a tela podia ser de um cliente; aqui quem olha é
   sempre quem vende. Vem por último: conclusão antes do fato lê como palpite. */
function oferta(d) {
  const ramo = ramoDe(d.cnae);
  const anos = anosDesde(d.abertura);
  if (!/ATIVA/i.test(d.situacao || "")) {
    return { travas: [`A empresa está como "${minusculo(d.situacao) || "situação desconhecida"}" na Receita. ` +
      "Sem situação ativa nenhum parceiro aprova operação — não gaste a visita."], cabe: [] };
  }
  const travas = [];
  if (d.mei) travas.push("É MEI: faturamento limitado e sem porte para crédito maior. Energia e seguro ainda cabem; capital de giro e antecipação, raramente.");
  if (anos !== null && anos < 2) travas.push(`Aberta há ${anos < 1 ? "menos de um ano" : "um ano"}. A maioria dos parceiros pede dois anos de casa para crédito.`);

  const cabe = [];
  if (ramo && /alta/.test(ramo.energia)) {
    cabe.push({ produto: "Energia", forca: ramo.energia === "muito alta" ? 2 : 1,
      porque: `Conta de luz ${ramo.energia} para o ramo — ${ramo.porque}.`,
      abordagem: "Peça a foto da conta de luz. Ninguém se sente ameaçado entregando conta de luz, e você volta com número." });
  }
  if (!d.mei && ramo && ramo.recebivel === "alto") {
    cabe.push({ produto: "Antecipação de recebíveis", forca: 2,
      porque: `Recebimento alto no ramo — ${ramo.porque}.`,
      abordagem: "Pergunte se ele já esperou o cartão cair para pagar fornecedor. A resposta abre a conversa sozinha." });
  }
  if (!d.mei && anos !== null && anos >= 2) {
    cabe.push({ produto: "Crédito para a empresa", forca: 1,
      porque: `${anos} anos de casa e situação ativa — tem histórico para apresentar.`,
      abordagem: "Capital de giro, ou com veículo/imóvel em garantia se houver — aí a taxa cai muito." });
  }
  cabe.push({ produto: "Seguro", forca: 0,
    porque: "Vale para qualquer empresa ativa: patrimonial no ponto, vida em grupo para quem tem funcionário.",
    abordagem: "É a venda que fecha mais rápido." });
  cabe.sort((a, b) => b.forca - a.forca);
  return { travas, cabe };
}

/* Empresário individual e MEI não têm sócio: a empresa é a própria pessoa.
   Dizer "não respondeu" ali ensinaria a desconfiar do bloco. O CPF do sócio
   não aparece — quem vende precisa do nome, não do documento. */
function socios(d) {
  if (d.qsa.length) {
    return d.qsa.map((s) => ({ nome: s.nome_socio || s.nome || "", papel: s.qualificacao_socio || s.qualificacao || "",
      desde: s.data_entrada_sociedade || s.data_entrada || "" }));
  }
  if (/individual/i.test(d.natureza || "") || d.mei) return [{ nome: d.razao || "", papel: "Titular (empresa individual)", desde: "" }];
  return null;
}

/* Cidade declarada contra a cidade do CEP. Sem tirar acento, "SAO PAULO" da
   Receita nunca bate com "São Paulo" do CEP, e o aviso acusaria toda empresa
   da capital — alarme falso ensina a ignorar o alarme verdadeiro. */
async function conferirEndereco(d) {
  if (!d.cep || d.cep.length !== 8) throw new Error("A empresa não declarou CEP válido.");
  const { corpo } = await buscarJson(`https://brasilapi.com.br/api/cep/v2/${d.cep}`);
  if (!corpo) throw new Error("A consulta do CEP não respondeu.");
  const chapado = (v) => semAcento(v).toUpperCase().trim();
  return { cidadeCep: corpo.city || null, confere: !d.municipio || !corpo.city || chapado(d.municipio) === chapado(corpo.city) };
}

/* ------------------------------------------------------------------- tela */

let fichaAtual = 0;          // cada abertura ganha um número; resposta atrasada de outra é ignorada
let rolagemDaLista = 0;

function abrirFicha(cnpj) {
  const minha = ++fichaAtual;
  const e = empresas.find((x) => x.cnpj === cnpj) || { cnpj };
  rolagemDaLista = window.scrollY;
  history.pushState({ ficha: cnpj }, "");    // o voltar do Android fecha a ficha, não o app

  $("#ficha-titulo").textContent = e.nome || e.rua || "Empresa";
  $("#ficha-cnpj").textContent = cnpjBonito(cnpj);
  $("#ficha-cnpj").dataset.cnpj = cnpj;
  $("#ficha-corpo").innerHTML = ["situacao", "leitura", "oferta", "socios", "contato", "endereco"]
    .map((id) => `<section class="bloco" id="bloco-${id}"><h3>${TITULOS[id]}</h3><p class="carregando">consultando…</p></section>`)
    .join("") + `<p class="dica" id="ficha-fonte"></p>`;
  $$(".tela").forEach((s) => s.classList.toggle("ativa", s.id === "tela-ficha"));
  window.scrollTo(0, 0);

  const pintarBloco = (id, html) => { if (minha === fichaAtual) $(`#bloco-${id}`).innerHTML = `<h3>${TITULOS[id]}</h3>${html}`; };
  const falhou = (id, msg) => pintarBloco(id, `<p class="falhou">${escapar(msg)}</p>`);

  consultarCadastro(cnpj).then((d) => {
    if (minha !== fichaAtual) return;
    pintarBloco("situacao", htmlSituacao(d));
    pintarBloco("leitura", htmlLeitura(leitura(d)));
    pintarBloco("oferta", htmlOferta(oferta(d)));
    const s = socios(d);
    s ? pintarBloco("socios", htmlSocios(s)) : falhou("socios", "A Receita não devolveu quadro societário para este CNPJ.");
    $("#ficha-fonte").textContent = `Consultado agora na ${d.fonte}, base pública da Receita Federal. ` +
      "Nada desta ficha fica guardado no aparelho.";

    /* O telefone do roteiro veio da mesma base, mas de outro mês: se a
       consulta de agora não trouxe, o de lá ainda serve. */
    const tel = d.telefone || (e.tel && e.tel.length >= 10 ? e.tel : null);
    if (d.email) pintarBloco("contato", htmlContato(tel, d.email, false));
    else {
      buscarContatoExtra(cnpj)
        .then((x) => pintarBloco("contato", htmlContato(tel || x.telefone, x.email, !!x.email)))
        .catch((err) => pintarBloco("contato", htmlContato(tel, null, false, err.message)));
    }
    /* Em MEI a consulta de agora costuma vir com a rua em branco (o endereço
       é o da casa do titular), e as duas fontes concordam nisso. O arquivo do
       roteiro, montado da base completa, tem a rua: serve de reserva. */
    if (!d.endereco && e.rua) { d.endereco = e.rua; d.ruaDoRoteiro = true; }
    conferirEndereco(d)
      .then((c) => pintarBloco("endereco", htmlEndereco(d, c)))
      .catch((err) => pintarBloco("endereco", htmlEndereco(d, null, err.message)));
  }).catch((err) => {
    falhou("situacao", err.message);
    for (const id of ["leitura", "oferta", "socios", "contato", "endereco"]) falhou(id, "Depende do cadastro, que não respondeu.");
  });
}

function fecharFicha() {
  fichaAtual++;   // o que ainda estiver chegando não pinta mais nada
  $$(".tela").forEach((s) => s.classList.toggle("ativa", s.id === "tela-rota"));
  window.scrollTo(0, rolagemDaLista);
}

const TITULOS = {
  situacao: "Situação na Receita",
  leitura: "O que isso quer dizer",
  oferta: "O que cabe oferecer",
  socios: "Quem responde pela empresa",
  contato: "Telefone e e-mail",
  endereco: "Endereço conferido",
};

function htmlSituacao(d) {
  const ativa = /ATIVA/i.test(d.situacao || "");
  const anos = anosDesde(d.abertura);
  const linhas = [
    ["Razão social", d.razao],
    ["Aberta em", d.abertura ? `${dataBR(d.abertura)}${anos !== null ? ` · ${anos === 1 ? "1 ano" : anos + " anos"}` : ""}` : ""],
    ["Tipo", [d.natureza, d.mei ? "MEI" : d.simples ? "Simples Nacional" : ""].filter(Boolean).join(" · ")],
    ["Porte", d.porte],
    ["Capital social", d.capital ? reais(d.capital) : ""],
    ["Atividade", d.atividade],
  ].filter(([, v]) => v);
  return `<p class="selo ${ativa ? "ok" : "pare"}">${escapar(d.situacao || "situação desconhecida")}${
      d.situacaoDesde ? ` desde ${escapar(dataBR(d.situacaoDesde))}` : ""}</p>
    <dl class="pares">${linhas.map(([k, v]) => `<dt>${k}</dt><dd>${escapar(v)}</dd>`).join("")}</dl>
    ${d.outras.length ? `<details class="mais-ativ"><summary>Mais ${d.outras.length} atividade${d.outras.length > 1 ? "s" : ""}</summary>
      <ul>${d.outras.map((c) => `<li>${escapar(c.descricao || c.codigo)}</li>`).join("")}</ul></details>` : ""}`;
}

function htmlLeitura(pontos) {
  if (!pontos.length) return `<p class="dica">Nada fora do comum no cadastro.</p>`;
  return pontos.map((p) => `<div class="ponto ${p.tom}"><b>${escapar(p.titulo)}</b><p>${escapar(p.texto)}</p></div>`).join("");
}

function htmlOferta(o) {
  return o.travas.map((t) => `<div class="ponto atencao"><p>${escapar(t)}</p></div>`).join("") +
    o.cabe.map((c) => `<div class="oferta"><b>${escapar(c.produto)}</b><p>${escapar(c.porque)}</p>
      <p class="abordagem">${escapar(c.abordagem)}</p></div>`).join("");
}

function htmlSocios(lista) {
  return `<ul class="socios">${lista.map((s) => `<li><b>${escapar(s.nome)}</b><span>${escapar(s.papel)}${
    s.desde ? ` · desde ${escapar(dataBR(s.desde).slice(-4))}` : ""}</span></li>`).join("")}</ul>`;
}

function htmlContato(tel, email, complementado, erro) {
  if (!tel && !email) return `<p class="falhou">${escapar(erro || "A empresa não declarou telefone nem e-mail.")}</p>`;
  return `<div class="acoes">
      ${tel ? `<a class="secundario" href="tel:+55${escapar(tel)}">${escapar(telBonito(tel))}</a>` : ""}
      ${email ? `<a class="secundario" href="mailto:${escapar(email)}">${escapar(email)}</a>` : ""}
    </div>
    ${!email && erro ? `<p class="dica">${escapar(erro)}</p>` : ""}
    <p class="dica">O que a empresa declarou à Receita${complementado ? " (o e-mail veio da CNPJ.ws)" : ""}. Contato de cadastro envelhece: confirme na visita.</p>`;
}

function htmlEndereco(d, c, erro) {
  const linha = [d.endereco, d.bairro, d.municipio && `${d.municipio} · ${d.uf}`, d.cep && `CEP ${d.cep.replace(/(\d{5})(\d{3})/, "$1-$2")}`]
    .filter(Boolean).join(" — ");
  const aviso = erro ? `<p class="dica">${escapar(erro)}</p>`
    : c.confere ? `<p class="dica">O CEP confere com a cidade declarada.</p>`
    : `<div class="ponto atencao"><b>O CEP é de ${escapar(c.cidadeCep)}, não de ${escapar(d.municipio)}</b>
       <p>Sinal de cadastro desatualizado: a empresa pode ter mudado de endereço.</p></div>`;
  return `<p>${escapar(linha)}</p>${d.ruaDoRoteiro ? `<p class="dica">A consulta de agora veio sem a rua; esta é a do arquivo do roteiro.</p>` : ""}${aviso}
    <div class="acoes"><a class="secundario" target="_blank" rel="noopener" href="${escapar(linkDoMapa([d.endereco, d.bairro, d.municipio, d.cep].filter(Boolean).join(", ")))}">No mapa</a></div>`;
}

/* ------------------------------------------------------------- ligações */

document.addEventListener("DOMContentLoaded", () => {
  if (!$("#ficha-voltar")) return;   // endereço antigo: a tela é só o aviso da mudança
  $("#ficha-voltar").addEventListener("click", () => history.back());
  window.addEventListener("popstate", () => {
    if ($("#tela-ficha").classList.contains("ativa")) fecharFicha();
  });
  $("#ficha-cnpj").addEventListener("click", () => {
    navigator.clipboard?.writeText($("#ficha-cnpj").dataset.cnpj)
      .then(() => avisar("CNPJ copiado."))
      .catch(() => avisar("Não consegui copiar."));
  });
});
