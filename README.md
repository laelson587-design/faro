# Faro

Quem visitar hoje, e por quê.

O nome é o que o app entrega: **ter faro** é enxergar onde vale a pena bater.
Você não compra uma lista — compra a capacidade de farejar quem abre a porta.

O [Acervo](../Acervo) responde *"o que é esta empresa"* — você traz o CNPJ. O
Faro responde a pergunta de antes: **"quais empresas"**. Para quem vende de
porta em porta e não tem lista nenhuma.

```
node scripts/servir.js     # http://localhost:3010
```

Sem dependência nenhuma — só o Node 24.

## Não existe servidor

Cada cidade é **um arquivo de texto**. O navegador baixa o da cidade escolhida
e faz tudo daí para frente ali dentro: filtra, agrupa, ordena, marca. Depois do
primeiro download a busca é instantânea, e funciona sem sinal.

Isso não é economia de infraestrutura, é a decisão que define o projeto:
**custo operacional zero**, para sempre. Arquivo estático se hospeda de graça,
e nenhuma máquina trabalha quando alguém pesquisa.

```
   uma vez, de madrugada          sempre, no aparelho de quem usa
   ────────────────────           ───────────────────────────────
   base da Receita (7 GB)   →     dados/SP-6789-maquininha.txt (88 KB)
   filtra, joga fora               baixa, pesquisa, marca
```

## A escolha é pelo que a pessoa vende

Ninguém sabe que lanchonete é CNAE 5611 — e quem soubesse não precisaria disto.
Então não há caixa de CNAE: há **três botões de profissão**, e a tradução para
CNAE acontece uma vez, em `ramos.js`.

| profissão | quem visitar |
| --- | --- |
| **Maquininha de cartão** | quem vende no balcão, cartão todo dia |
| **Antecipação de recebíveis** | quem fatura a prazo e espera para receber |
| **Energia** | quem tem conta de luz pesada |

**A tabela de ramos veio inteira do Acervo**, onde nasceu para responder "dada
esta empresa, o que eu ofereço". Aqui ela é lida ao contrário: "dado o que eu
vendo, quais empresas". Mesmos 25 prefixos, mesmos porquês — **mexeu numa, mexa
na outra.**

E o `porque` de cada ramo aparece no cartão, porque é o que se fala na porta.
Chegar dizendo *"sua câmara fria não desliga"* abre conversa; chegar dizendo
*"tenho um produto de energia"* fecha porta.

## O produto não é a lista, é o roteiro

Lista de 800 linhas dá a mesma paralisia de não ter lista nenhuma. Por isso:

- **Agrupado por bairro**, porque um dia de visita é um bairro, não uma cidade
- **Ordenado por rua** dentro do bairro, para a caminhada fazer sentido
- **"Visitei" fica guardado neste aparelho**, e a lista encolhe conforme se
  trabalha. Sem isso todo dia começa igual e revisita-se quem já disse não.
- **O peso do download aparece antes de baixar** — ninguém gosta de surpresa
  no 4G

Tocar no CNPJ copia. Cola no Acervo e sai a situação cadastral, os sócios e as
sanções, ao vivo. **Aqui é onde procurar; lá é com quem dá para fechar.**

## Montar os dados

```
node scripts/montar.js                 # Brasil inteiro
node scripts/montar.js --uf SP         # só um estado
node scripts/montar.js 6789 7107       # só estas cidades
node scripts/montar.js --lotes 1,9     # só estes lotes, para experimentar
```

Baixa da base aberta da Receita Federal, **um arquivo por vez e apagando antes
do próximo**. São dez arquivos de Estabelecimentos somando quase 7 GB, e a
máquina onde isto nasceu tinha 12 GB livres — guardar todos antes de processar
não caberia, e não precisa: cada um é lido em fluxo e só o que passa no filtro
fica.

Guarda só empresas **ativas**, e só o que serve para bater na porta: CNPJ, nome
fantasia, CNAE, endereço, telefone e data de abertura. **Nada de sócio, nada de
CPF** — dado de pessoa não entra aqui.

Roda uma vez por trimestre. A base da Receita é mensal, mas endereço de loja
não muda todo mês, e o que decide o dia é a lista existir.

## Um arquivo por cidade **e por profissão**

Medido, não estimado:

| | empresas | download |
| --- | --- | --- |
| Osasco · maquininha | 3.725 | **88 KB** |
| Campinas · maquininha | 7.923 | ~270 KB |
| São Paulo · maquininha | 83.121 | ~2,9 MB |

Com todos os ramos num arquivo só, São Paulo capital dava **24 MB** — ninguém
baixa isso na rua. Separado por profissão, cai para um quinto: quem vende
maquininha não carrega transportadora nem construtora.

## O que ainda não está resolvido

- **São Paulo capital ainda é o maior arquivo.** Projetado em ~14 MB com a base
  completa. O conserto é separar por zona ou por faixa de CEP — um vendedor da
  zona leste não precisa da zona oeste.
- **Os números acima saíram de 2 dos 10 lotes.** Multiplique por cinco para a
  base inteira. O caminho está provado; falta a noite de download.
- **Vender exige cadeado.** Arquivo estático em endereço público é arquivo que
  qualquer um copia. No dia de cobrar, isso precisa de servidor — e aí o
  servidor é pago por quem paga. A ordem certa é essa: primeiro provar que
  serve.

## De onde vêm os dados

[Dados abertos do CNPJ](https://www.gov.br/receitafederal/dados), Receita
Federal, publicados mensalmente. Empresa é dado público de origem.

Lista em massa para abordagem fria é onde a LGPD olha **finalidade**, não
origem — por isso aqui não entra nada de pessoa física, e por isso a marcação
de visita fica só no aparelho de quem visitou.
