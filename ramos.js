/* Quem vende o quê, e para quem.
 *
 * A tabela de RAMOS veio inteira do Acervo (`blocos.js`), onde nasceu para
 * responder "dada esta empresa, o que eu ofereço". Aqui ela é lida ao
 * contrário: "dado o que eu vendo, quais empresas". Mesma tabela, mesmos 25
 * prefixos, mesmos porquês — e é por isso que as PROFISSOES abaixo não são
 * chute: cada uma sai de um eixo que já estava lá.
 *
 * MEXEU NUMA, MEXA NA OUTRA. Se um prefixo mudar de peso no Acervo, ele muda
 * a quem esta lista manda visitar.
 */

const RAMOS = [
  { p: "9601", nome: "lavanderia", energia: "muito alta", recebivel: "médio",
    porque: "máquina e secadora rodando o dia inteiro" },
  { p: "1091", nome: "panificação", energia: "muito alta", recebivel: "alto",
    porque: "forno ligado desde a madrugada" },
  { p: "4721", nome: "padaria e mercearia", energia: "muito alta", recebivel: "alto",
    porque: "forno mais refrigeração, e venda de cartão o dia todo" },
  { p: "4722", nome: "açougue e peixaria", energia: "muito alta", recebivel: "alto",
    porque: "câmara fria não desliga" },
  { p: "4711", nome: "supermercado", energia: "muito alta", recebivel: "alto",
    porque: "ilhas de congelado e refrigeração em toda a loja" },
  { p: "4712", nome: "mercearia e minimercado", energia: "alta", recebivel: "alto",
    porque: "geladeiras e freezers ligados sem parar" },
  { p: "4723", nome: "comércio de bebidas", energia: "alta", recebivel: "alto",
    porque: "cervejeira e freezer o dia inteiro" },
  { p: "5611", nome: "restaurante, bar e lanchonete", energia: "muito alta", recebivel: "alto",
    porque: "cozinha, refrigeração e ar-condicionado juntos" },
  { p: "5612", nome: "alimentação", energia: "alta", recebivel: "alto",
    porque: "cozinha e refrigeração" },
  { p: "5620", nome: "fornecimento de comida", energia: "alta", recebivel: "médio",
    porque: "cozinha industrial" },
  { p: "55", nome: "hotel e pousada", energia: "muito alta", recebivel: "alto",
    porque: "ar-condicionado e água quente em todos os quartos" },
  { p: "9313", nome: "academia", energia: "alta", recebivel: "alto",
    porque: "ar-condicionado o dia todo e mensalidade no cartão" },
  { p: "9602", nome: "salão de beleza", energia: "média", recebivel: "alto",
    porque: "movimento diário quase todo no cartão" },
  { p: "8630", nome: "clínica e consultório", energia: "média", recebivel: "alto",
    porque: "convênio demora a pagar, e é aí que a antecipação entra" },
  { p: "86", nome: "saúde", energia: "média", recebivel: "alto",
    porque: "recebimento de convênio costuma atrasar" },
  { p: "4520", nome: "oficina mecânica", energia: "média", recebivel: "médio",
    porque: "peça comprada à vista e serviço pago parcelado" },
  { p: "45", nome: "veículos", energia: "média", recebivel: "médio",
    porque: "ticket alto e parcelamento longo" },
  { p: "4930", nome: "transporte de carga", energia: "baixa", recebivel: "alto",
    porque: "frete faturado, e frota que serve de garantia" },
  { p: "49", nome: "transporte", energia: "baixa", recebivel: "alto",
    porque: "faturamento a prazo" },
  { p: "46", nome: "atacado", energia: "média", recebivel: "alto",
    porque: "vende no boleto e espera trinta dias para receber" },
  { p: "47", nome: "comércio varejista", energia: "média", recebivel: "alto",
    porque: "venda de cartão todo dia" },
  { p: "41", nome: "construção", energia: "baixa", recebivel: "médio",
    porque: "obra consome caixa antes de faturar" },
  { p: "43", nome: "obras e instalações", energia: "baixa", recebivel: "médio",
    porque: "material comprado antes de receber" },
  { p: "85", nome: "educação", energia: "alta", recebivel: "alto",
    porque: "prédio com ar-condicionado e mensalidade recorrente" },
  { p: "10", nome: "indústria de alimentos", energia: "muito alta", recebivel: "alto",
    porque: "produção com maquinário pesado" },
];

/* Do prefixo mais longo para o mais curto: 4721 tem de ganhar de 47. */
const POR_TAMANHO = [...RAMOS].sort((a, b) => b.p.length - a.p.length);

function ramoDe(cnae) {
  const c = String(cnae ?? "").replace(/\D/g, "");
  if (!c) return null;
  return POR_TAMANHO.find((r) => c.startsWith(r.p)) || null;
}

/**
 * As profissões que este app atende.
 *
 * Ninguém sabe que lanchonete é 5611 — e quem soubesse não precisaria do app.
 * Então a escolha é pelo que a pessoa VENDE, e a tradução para CNAE acontece
 * aqui, uma vez.
 *
 * `porque` é o que o vendedor fala na porta. Sai da mesma coluna do Acervo:
 * chegar dizendo "sua câmara fria não desliga" abre conversa; chegar dizendo
 * "tenho um produto" fecha porta.
 */
const PROFISSOES = [
  {
    id: "maquininha",
    nome: "Maquininha de cartão",
    dica: "quem vende no balcão, cartão todo dia",
    // Recebível alto E venda presencial. Atacado e transporte ficam de fora:
    // faturam no boleto, não passam cartão.
    prefixos: ["4721", "4722", "4711", "4712", "4723", "5611", "5612", "5620",
               "9602", "9313", "8630", "47", "1091", "9601", "4520"],
  },
  {
    id: "antecipacao",
    nome: "Antecipação de recebíveis",
    dica: "quem fatura a prazo e espera para receber",
    prefixos: ["46", "4930", "49", "86", "8630", "85", "45", "41", "43", "10"],
  },
  {
    id: "energia",
    nome: "Energia",
    dica: "quem tem conta de luz pesada",
    prefixos: RAMOS.filter((r) => r.energia === "muito alta" || r.energia === "alta")
      .map((r) => r.p),
  },
  {
    id: "todos",
    nome: "Todos os ramos",
    dica: "sem filtro de profissão",
    prefixos: RAMOS.map((r) => r.p),
  },
];

/* A união de tudo que qualquer profissão pode pedir. É o que o montador
   guarda no arquivo da cidade — filtrar por profissão acontece no navegador,
   em cima do que já foi baixado, sem ida ao servidor. */
const TODOS_OS_PREFIXOS = [...new Set(PROFISSOES.flatMap((p) => p.prefixos))];

function serveA(profissaoId, cnae) {
  const prof = PROFISSOES.find((p) => p.id === profissaoId);
  if (!prof) return false;
  const c = String(cnae ?? "").replace(/\D/g, "").padStart(7, "0");
  return prof.prefixos.some((p) => c.startsWith(p));
}

if (typeof module !== "undefined") {
  module.exports = { RAMOS, PROFISSOES, TODOS_OS_PREFIXOS, ramoDe, serveA };
}
