# Relatório — Suspeita de mapeamento incorreto de mercado (NHL player props)

Data da investigação: 2026-09-06
Escopo: `pipeline/get_nhl_props.js` + `pipeline/model_nhl_props.js`
Nenhuma correção foi aplicada — apenas investigação.

## 1. Sintoma reportado

Apostas "Under 2.5 goals" (jogador individual) venceram 6 de 6, com probabilidade
real do evento próxima de 97%, enquanto o mercado pagou 1,45–1,83 (implícita
55%–69%). Um edge dessa magnitude é implausível para o mercado real de gols de
jogador na NHL.

## 2. Limitação de dados

Hoje (6/set/2026) a NHL está em off-season — `fetchEvents()` retornaria vazio,
então não foi possível reproduzir o problema com uma chamada ao vivo à The Odds
API. O único histórico persistido na branch `data` é
`odds_history/hockey_nhl_model_2026-05.json` (28 entradas, um único dia,
2026-05-02), e nele existe apenas **uma** entrada de `goals` (linha 0.5, edge
-1.6%) — nenhuma com linha 2.5. O arquivo intermediário bruto `nhl_props.json`
(saída não agregada de `get_nhl_props.js`) não é versionado, portanto não há
como inspecionar diretamente as cotações por casa de apostas do episódio
relatado. A conclusão abaixo é baseada em auditoria de código, não na
reprodução do incidente específico.

## 3. Chave de mercado consumida

`get_nhl_props.js:65` define:
```
const MARKETS = 'player_points,player_goals,player_assists,player_shots_on_goal';
```
`player_goals` é, pela própria documentação da The Odds API, o mercado padrão
"Goals (Over/Under)" por jogador — exatamente o que `model_nhl_props.js`
assume (`PROP_MAP.goals = 'goals'`, comparado contra a média de gols/jogo do
histórico do jogador). **A chave de mercado está correta** — não há
mapeamento para um mercado de estatística errada (não é shots, não é pontos).

## 4. O bug real: agregação cruzada de casas ignora a linha

Em `get_nhl_props.js:143-171` (idêntico em `get_nfl_props.js:107-137` e
`get_tennis_props.js`):

```js
// Agrega a melhor odd Over e Under por mercado entre todas as casas disponíveis
const bestMarkets = {};
for (const bm of data.bookmakers) {
  for (const mkt of (bm.markets ?? [])) {
    if (!bestMarkets[mkt.key]) bestMarkets[mkt.key] = { key: mkt.key, bestOutcomes: {} };
    for (const outcome of mkt.outcomes) {
      const k = `${outcome.description}||${outcome.name}`;   // <-- SEM outcome.point
      if (!bestMarkets[mkt.key].bestOutcomes[k] ||
          outcome.price > bestMarkets[mkt.key].bestOutcomes[k].price) {
        bestMarkets[mkt.key].bestOutcomes[k] = outcome;
      }
    }
  }
}
...
for (const [player, sides] of Object.entries(players)) {
  if (!sides.Over || !sides.Under) continue;
  ...
  line: sides.Over.line,
  oddsOver: sides.Over.price,
  oddsUnder: sides.Under.price,
```

A chave de deduplicação `k` é `descrição-do-jogador||Over/Under` — **não
inclui `outcome.point` (a linha)**. Quando duas casas de apostas discordam da
linha para o mesmo jogador/mercado (comum: uma casa usa 0.5, outra usa 1.5 ou
2.5 para um artilheiro em sequência de gols), o código:

1. Escolhe o **Over** com maior preço entre todas as casas, de qualquer linha.
2. Escolhe o **Under** com maior preço entre todas as casas, de qualquer linha
   — **independentemente da casa/linha escolhida no passo 1**.
3. Grava `line: sides.Over.line` — ou seja, o valor da linha exibido/usado
   pelo modelo vem *apenas* da casa que venceu o lado Over.
4. Não existe nenhuma verificação de que `sides.Over.line === sides.Under.line`.

Resultado possível: `oddsUnder` anexado ao prop pode pertencer a uma linha
**diferente** daquela registrada em `line` e usada por `oddsOver`.

## 5. Por que isso reproduz exatamente o sintoma

Para um mercado real de "player_goals":
- Numa linha baixa (0.5 — "sem gol"), o Under é um evento de probabilidade
  moderada (~55%-70%), então seu preço fica na faixa 1,4–1,8.
- Numa linha alta (2.5 — "3+ gols", evento raríssimo), o Under é quase certo
  (~97%+), então seu preço correto seria próximo de 1,02–1,08; o Over correto
  seria uma odd bem mais alta (longshot).

No passo 2 acima, o algoritmo busca o **maior** preço de Under entre casas —
e o maior preço de Under tende a vir justamente da casa com a linha **mais
baixa** (0.5), porque ali o Under ainda é um evento competitivo (~1,6), nunca
da casa com linha 2.5 (cujo Under paga ~1,02, preço baixo demais para vencer a
comparação "outcome.price > bestOutcomes[k].price"). Enquanto isso, o maior
preço de Over tende a vir da casa com a linha alta (2.5), que paga uma odd de
longshot.

Isso produz exatamente a montagem observada: `line = 2.5` (vindo da casa do
Over), `oddsUnder ≈ 1,45–1,83` (na verdade o preço real do Under **0.5** de
outra casa, e não do Under 2.5). O modelo, ao ver `line = 2.5`, calcula
corretamente que a probabilidade real de "menos de 2.5 gols" é ~97% — e o
jogador de fato bate isso quase sempre (6/6), porque é um evento genuinamente
raro (hat-trick). Só que o preço comparado nunca foi a cotação de mercado para
esse evento: era a cotação de um evento mais restrito e menos provável ("zero
gols"), de outra casa. O "edge" gigante é um artefato da mistura de linhas, não
uma ineficiência real da casa.

## 6. Mesma inconsistência em outros mercados de NHL?

Nos dados de 2026-05-02 (únicos disponíveis), a comparação probabilidade
média do modelo vs. implícita média do mercado por prop foi:

| prop    | n  | prob. modelo (méd.) | prob. implícita (méd.) | diferença |
|---------|----|----------------------|--------------------------|-----------|
| shots   | 6  | 68,5%                | 59,2%                   | 9,3 p.p.  |
| assists | 12 | 39,2%                | 36,3%                   | 2,9 p.p.  |
| points  | 9  | 70,3%                | 65,0%                   | 5,3 p.p.  |
| goals   | 1  | 74,7%                | 76,3%                   | -1,6 p.p. |

Nenhuma dessas entradas mostra o gap de escala extremo do sintoma relatado —
mas a amostra é de um único dia e o mercado de `shots` já aparece com linhas
divergentes entre jogadores (1.5, 2.5, 3.5), que é exatamente a condição
(múltiplas linhas em uso no mesmo mercado) que expõe o bug do item 4. Ou seja,
o código está igualmente exposto em `shots`, `points` e `assists` — só não há,
nestes dados, um caso registrado onde o bug se manifestou de forma extrema.

## 7. Abrangência do bug no repositório

O mesmo padrão de agregação (dedupe por `descrição||nome`, sem `point`) existe
em:
- `pipeline/get_nhl_props.js` (linhas 144-171)
- `pipeline/get_nfl_props.js` (linhas 108-137)
- `pipeline/get_tennis_props.js` (descontinuado — commit `321ec02`)

**Não afeta** `get_nba_props.js` nem `get_mlb_props.js`, porque esses dois
pipelines não fazem agregação entre casas: usam apenas uma única bookmaker
fixa (`bookmakers?.[0]` no NBA, `BOOKMAKER` fixo no MLB), então Over e Under de
um mesmo prop sempre vêm da mesma casa/mesma linha.

## 8. Conclusão

A divergência não se origina na chave de mercado da The Odds API
(`player_goals` está correta e corresponde ao que o modelo assume) nem no
cálculo estatístico do modelo (a distribuição normal sobre a média de gols do
jogador está sendo aplicada corretamente à linha recebida). A origem é a
etapa de agregação "melhor odd entre casas" em `get_nhl_props.js` (linhas
144-171): a chave de deduplicação ignora `outcome.point`, permitindo que o
`line` gravado e o `oddsUnder`/`oddsOver` gravados venham de casas de apostas
diferentes cotando linhas diferentes. Isso é capaz de produzir exatamente o
padrão relatado — vitória quase garantida (linha alta, real) cotada com o
preço de um evento bem menos provável (linha baixa, de outra casa) — sem que
seja necessário nenhum erro na chave de mercado ou no modelo estatístico.

Nenhuma correção foi aplicada, conforme solicitado.
