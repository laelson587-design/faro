/* Rota — monta o roteiro de visita do dia, no aparelho de quem pesquisa.
 *
 * Não há servidor. O app baixa um arquivo de texto da cidade escolhida e faz
 * tudo daí para frente aqui dentro: filtrar, agrupar, ordenar, marcar. Isso é
 * o que torna o custo operacional zero — e o que faz a busca ser instantânea
 * depois do primeiro download, mesmo sem sinal.
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const CHAVE_VISITADAS = "rota.visitadas.v1";
const POR_VEZ = 60;          // quantas mostra antes de "mostrar mais"

let indice = null;           // dados/cidades.json
let nomesCnae = {};          // dados/cnaes.json
let empresas = [];           // a cidade carregada
let mostrando = POR_VEZ;
let profissaoEscolhida = null;

// --------------------------------------------------------------- guardado

/* As visitadas ficam neste aparelho e em nenhum outro lugar. É o que faz a
   lista ENCOLHER conforme se trabalha — sem isso, todo dia começa igual e
   revisita-se quem já disse não. */
function visitadas() {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_VISITADAS) || "[]")); }
  catch (e) { return new Set(); }
}

function marcarVisitada(cnpj, marcar) {
  const v = visitadas();
  if (marcar) v.add(cnpj); else v.delete(cnpj);
  try { localStorage.setItem(CHAVE_VISITADAS, JSON.stringify([...v])); }
  catch (e) { avisar("Este navegador não deixou guardar a marcação."); }
}

// ----------------------------------------------------------------- ajudas

let relogioAviso = null;
function avisar(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.remove("oculto");
  clearTimeout(relogioAviso);
  relogioAviso = setTimeout(() => el.classList.add("oculto"), 3000);
}

const escapar = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function cnpjBonito(c) {
  const d = String(c).replace(/\D/g, "").padStart(14, "0");
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function telBonito(t) {
  const d = String(t || "").replace(/\D/g, "");
  if (d.length < 10) return "";
  const ddd = d.slice(0, 2), resto = d.slice(2);
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}

/** "20240315" → "mar/2024", e o tempo de casa, que é o que abre conversa. */
function abertura(d) {
  if (!/^\d{8}$/.test(d)) return { texto: "", anos: null };
  const ano = +d.slice(0, 4), mes = +d.slice(4, 6);
  const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const anos = new Date().getFullYear() - ano;
  return { texto: `${MESES[mes - 1] || ""}/${ano}`, anos };
}

const tamanho = (n) => n < 1024 ? n + " B"
  : n < 1048576 ? (n / 1024).toFixed(0) + " KB"
  : (n / 1048576).toFixed(1) + " MB";

// ------------------------------------------------------------- a escolha

async function comecar() {
  try {
    const r = await fetch("dados/cidades.json");
    indice = await r.json();
  } catch (e) {
    return avisar("Não consegui ler a lista de cidades.");
  }

  fetch("dados/cnaes.json").then((r) => r.json()).then((n) => { nomesCnae = n; }).catch(() => {});

  const [ano, mes] = (indice.base || "").split("-");
  if (ano) $("#base-mes").textContent = `Base de ${mes}/${ano}.`;

  const sel = $("#cidade");
  sel.innerHTML = `<option value="">escolha…</option>` + indice.cidades
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((c) => `<option value="${c.uf}-${c.cod}">${escapar(c.nome)} · ${c.uf}</option>`)
    .join("");

  $("#profissoes").innerHTML = PROFISSOES
    .filter((p) => p.id !== "todos")
    .map((p) => `<button class="profissao" data-id="${p.id}">
        <span class="nome">${escapar(p.nome)}</span>
        <span class="dica">${escapar(p.dica)}</span>
      </button>`).join("");

  $$(".profissao").forEach((b) => b.addEventListener("click", () => {
    profissaoEscolhida = b.dataset.id;
    $$(".profissao").forEach((x) => x.classList.toggle("ativo", x === b));
    conferirEscolha();
  }));

  sel.addEventListener("change", conferirEscolha);
  $("#zona").addEventListener("change", conferirEscolha);
  $("#buscar").addEventListener("click", montarRoteiro);
  $("#voltar").addEventListener("click", () => irPara("escolha"));

  // Lembra a última escolha: quem usa isto usa todo dia, na mesma cidade.
  const ultima = localStorage.getItem("rota.ultima");
  if (ultima) {
    const [cidade, prof, zona] = ultima.split("|");
    if ([...sel.options].some((o) => o.value === cidade)) sel.value = cidade;
    const botao = $(`.profissao[data-id="${prof}"]`);
    if (botao) botao.click();
    // Depois do clique as zonas já foram desenhadas, então dá para escolher.
    if (zona) { $("#zona").value = zona; conferirEscolha(); }
  }
  conferirEscolha();
}

/**
 * Diz o peso do download ANTES de baixar. Ninguém gosta de surpresa no 4G.
 *
 * Nas cidades grandes o número que interessa é o da ZONA escolhida, não o
 * da cidade inteira: quem vai bater porta na Zona Sul não baixa a Norte, e
 * mostrar o total assustaria à toa.
 */
function conferirEscolha() {
  const cidade = $("#cidade").value;
  const c = cidade && indice.cidades.find((x) => `${x.uf}-${x.cod}` === cidade);
  const p = c && profissaoEscolhida && c.profissoes[profissaoEscolhida];

  pintarZonas(p);

  const escolha = fatiaEscolhida(p);
  const pronto = !!escolha;
  $("#buscar").disabled = !pronto;

  if (!cidade || !profissaoEscolhida) { $("#peso").textContent = ""; return; }
  if (!p) {
    $("#peso").textContent = "Nenhuma empresa desse ramo nesta cidade.";
    return;
  }
  if (!escolha) { $("#peso").textContent = "Escolha a região."; return; }

  $("#peso").textContent =
    `${escolha.empresas.toLocaleString("pt-BR")} empresas · baixa uma vez, cerca de ${tamanho(escolha.bytes / 4)}`;
}

/** O seletor de região só existe onde a cidade foi fatiada. */
function pintarZonas(p) {
  const tem = !!(p && p.zonas);
  $("#campo-zona").classList.toggle("oculto", !tem);
  if (!tem) { $("#zona").innerHTML = ""; return; }

  const antes = $("#zona").value;
  $("#zona").innerHTML = `<option value="">escolha a região…</option>` +
    p.zonas.map((z) => `<option value="${escapar(z.zona)}">${escapar(z.nome)} · ${
      z.empresas.toLocaleString("pt-BR")}</option>`).join("");
  if (p.zonas.some((z) => z.zona === antes)) $("#zona").value = antes;
}

/** O pedaço que vai ser baixado: a cidade inteira, ou uma zona dela. */
function fatiaEscolhida(p) {
  if (!p) return null;
  if (!p.zonas) return { empresas: p.empresas, bytes: p.bytes, sufixo: "" };
  const z = p.zonas.find((x) => x.zona === $("#zona").value);
  return z ? { empresas: z.empresas, bytes: z.bytes, sufixo: "-" + z.zona, nome: z.nome } : null;
}

// -------------------------------------------------------------- o roteiro

async function montarRoteiro() {
  const cidade = $("#cidade").value;
  const c = indice.cidades.find((x) => `${x.uf}-${x.cod}` === cidade);
  const fatia = fatiaEscolhida(c.profissoes[profissaoEscolhida]);
  if (!fatia) return avisar("Escolha a região.");
  localStorage.setItem("rota.ultima",
    `${cidade}|${profissaoEscolhida}|${$("#zona").value || ""}`);

  $("#buscar").disabled = true;
  $("#buscar").textContent = "Baixando…";

  try {
    const r = await fetch(`dados/${cidade}-${profissaoEscolhida}${fatia.sufixo}.txt`);
    if (!r.ok) throw new Error("arquivo não encontrado");
    const texto = await r.text();
    empresas = texto.split("\n").filter(Boolean).map((l) => {
      const [cnpj, nome, cnae, rua, bairro, cep, tel, abriu] = l.split("\t");
      return { cnpj, nome, cnae, rua, bairro, cep, tel, abriu };
    });
  } catch (e) {
    $("#buscar").disabled = false;
    $("#buscar").textContent = "Montar o roteiro";
    return avisar("Não consegui baixar esta cidade.");
  }

  $("#buscar").disabled = false;
  $("#buscar").textContent = "Montar o roteiro";

  const prof = PROFISSOES.find((p) => p.id === profissaoEscolhida);
  $("#rota-titulo").textContent = fatia.nome ? `${c.nome} · ${fatia.nome}` : c.nome;
  $("#rota-sub").textContent = prof.nome.toLowerCase();

  // Bairros por quantidade: onde há mais porta, há mais dia de trabalho.
  const contagem = new Map();
  for (const e of empresas) contagem.set(e.bairro, (contagem.get(e.bairro) || 0) + 1);
  const bairros = [...contagem].sort((a, b) => b[1] - a[1]);
  $("#bairro").innerHTML = `<option value="">todos os bairros</option>` +
    bairros.map(([b, n]) => `<option value="${escapar(b)}">${escapar(b || "sem bairro")} · ${n}</option>`).join("");

  mostrando = POR_VEZ;
  irPara("rota");
  pintar();
}

function filtradas() {
  const bairro = $("#bairro").value;
  const soTel = $("#so-telefone").checked;
  const soNovas = $("#so-novas").checked;
  const esconder = $("#esconder-visitadas").checked;
  const jaFui = visitadas();
  const corte = String(new Date().getFullYear() - 2) + "0000";

  return empresas.filter((e) => {
    if (bairro && e.bairro !== bairro) return false;
    if (soTel && !e.tel) return false;
    if (soNovas && !(e.abriu >= corte)) return false;
    if (esconder && jaFui.has(e.cnpj)) return false;
    return true;
  });
}

function pintar() {
  const lista = filtradas();
  const jaFui = visitadas();

  $("#contagem").textContent = lista.length
    ? `${lista.length.toLocaleString("pt-BR")} para visitar`
    : "Nenhuma com esses filtros.";

  /* Agrupa por bairro e ordena por rua dentro dele. Uma lista solta de 800
     linhas é a mesma paralisia da lista que não se usa; um bairro por vez,
     com as ruas juntas, vira caminhada. */
  const porBairro = new Map();
  for (const e of lista.slice(0, mostrando)) {
    if (!porBairro.has(e.bairro)) porBairro.set(e.bairro, []);
    porBairro.get(e.bairro).push(e);
  }

  const blocos = [];
  for (const [bairro, itens] of porBairro) {
    itens.sort((a, b) => (a.rua || "").localeCompare(b.rua || "", "pt-BR"));
    blocos.push(`<h3 class="bairro">${escapar(bairro || "sem bairro")} · ${itens.length}</h3>`);
    for (const e of itens) {
      const ramo = ramoDe(e.cnae);
      const ab = abertura(e.abriu);
      const fui = jaFui.has(e.cnpj);
      blocos.push(`
        <div class="empresa ${fui ? "visitada" : ""}">
          <!-- Sem nome fantasia, quem identifica é o endereço: é o que se vê
               na fachada. Repetir o ramo no lugar do nome fazia o cartão
               parecer quebrado, com a mesma frase duas vezes. -->
          <p class="nome ${e.nome ? "" : "anonima"}">${
            escapar(e.nome || e.rua || "(sem nome)")}</p>
          <p class="ramo">${escapar(nomesCnae[e.cnae] || e.cnae)}</p>
          ${e.nome ? `<p class="endereco">${escapar(e.rua)}</p>` : ""}
          ${ramo ? `<p class="porque">${escapar(ramo.porque)}</p>` : ""}
          <p class="pe">
            ${ab.texto ? `<span>abriu em ${escapar(ab.texto)}${
              ab.anos !== null && ab.anos <= 2 ? " · <b>nova</b>" : ""}</span>` : ""}
          </p>
          <div class="acoes">
            ${e.tel ? `<a class="secundario" href="tel:+55${escapar(e.tel)}">${escapar(telBonito(e.tel))}</a>`
                    : `<span class="secundario apagado">sem telefone</span>`}
            <button class="secundario" data-cnpj="${escapar(e.cnpj)}">${escapar(cnpjBonito(e.cnpj))}</button>
            <button class="secundario visitar" data-visitar="${escapar(e.cnpj)}">${fui ? "Desmarcar" : "Visitei"}</button>
          </div>
        </div>`);
    }
  }

  $("#lista").innerHTML = blocos.join("") ||
    `<p class="vazio">Nada aqui. Afrouxe um filtro.</p>`;
  $("#mais").classList.toggle("oculto", lista.length <= mostrando);
  $("#mais").textContent = `Mostrar mais ${Math.min(POR_VEZ, lista.length - mostrando)}`;
}

function irPara(tela) {
  $$(".tela").forEach((s) => s.classList.toggle("ativa", s.id === "tela-" + tela));
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------- ligações

document.addEventListener("DOMContentLoaded", () => {
  ["#bairro", "#so-telefone", "#so-novas", "#esconder-visitadas"].forEach((s) =>
    $(s).addEventListener("change", () => { mostrando = POR_VEZ; pintar(); }));

  $("#mais").addEventListener("click", () => { mostrando += POR_VEZ; pintar(); });

  $("#lista").addEventListener("click", (ev) => {
    const visitar = ev.target.closest("[data-visitar]");
    if (visitar) {
      const cnpj = visitar.dataset.visitar;
      const marcar = !visitadas().has(cnpj);
      marcarVisitada(cnpj, marcar);
      avisar(marcar ? "Marcada como visitada." : "Desmarcada.");
      pintar();
      return;
    }

    /* O CNPJ copiado é a ponte para o Acervo: cola lá e sai a situação
       cadastral, os sócios e as sanções, ao vivo. Aqui é onde procurar; lá é
       com quem se pode fechar. */
    const copiar = ev.target.closest("[data-cnpj]");
    if (copiar) {
      const cnpj = copiar.dataset.cnpj;
      navigator.clipboard?.writeText(cnpj)
        .then(() => avisar("CNPJ copiado — cole no Acervo para a ficha completa."))
        .catch(() => avisar("Não consegui copiar."));
    }
  });

  comecar();
});
