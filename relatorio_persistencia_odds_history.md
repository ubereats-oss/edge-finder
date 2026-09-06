# Relatório — Persistência de `odds_history/` nos workflows do GitHub Actions

Data da investigação: 2026-09-06
Nenhuma correção foi aplicada — apenas investigação.

## Correção importante sobre um relatório anterior desta mesma conversa

O relatório de mapeamento de mercado NHL (mais cedo nesta conversa) e a mensagem
sobre o histórico central citaram um arquivo `odds_history/hockey_nhl_model_2026-05.json`
como existente na branch `data`, lido via `git show origin/data:...` **sem um
`git fetch --force` antes**. O ref local `origin/data` deste repositório estava
desatualizado (cache de uma sessão anterior, apontando para o commit `9069bc7`
de 2/mai/2026). Ao rodar `git fetch origin data --force` para esta investigação,
o ref real avançou para `1240c40` (5/set/2026) — **e esse arquivo não existe na
branch `data` atual**. A conclusão sobre a origem do bug de agregação de odds
(baseada na leitura do código) continua válida; o dado específico "existe 1 dia
de histórico do modelo na branch data" estava desatualizado e é substituído
pelas evidências abaixo.

## 1. Mapeamento por workflow

| Workflow | Gatilho | Restaura `odds_history/` antes? | Escreve em `odds_history/`? | Salva `odds_history/` ao final? | Estratégia de commit/push |
|---|---|---|---|---|---|
| `update_all.yml` (5 jobs: nba/mlb/nhl/nfl/tennis + save-data) | cron diário 18:00 UTC + manual | Não | Sim — cada job roda `model_*_props.js`, que grava em `odds_history/*_model_<mês>.json` e (a partir de hoje) `model_ledger_<esporte>_<mês>.json` | **Não.** "Empacotar artefatos" de cada esporte só copia uma lista fixa de arquivos (`*_props_results.json`, stats, team maps, `bets.json`) — nunca nada de `odds_history/` | `git checkout -b data-work origin/data --force` (traz a branch inteira) + `git add` de uma lista curada + `git push origin data-work:data` (sem `--force`) |
| `update_player_stats.yml` | cron diário 10:00 UTC + manual | Não | Não roda modelo, não toca `odds_history/` | N/A | Mesmo padrão seguro de `update_all.yml` (curated checkout + push sem force) |
| `update_tennis_ranking.yml` | cron semanal (seg 17:00 UTC) + manual | Não | Não | N/A | Mesmo padrão seguro, só mexe em `ranking.json` |
| `odds_history.yml` | cron diário 19:00 UTC + manual | Sim, mas de uma branch **diferente** (`history`, tar.gz) — e só contém snapshots H2H de `save_odds_history.js`, nunca histórico de props/modelo | Sim, mas só H2H (`save_odds_history.js`) | Sim — re-empacota **todo** o diretório `odds_history/` local e força-push pra branch `history` | `git checkout --orphan history-tmp; git rm -rf .; ...; git push origin HEAD:history --force` — destrutivo, mas isolado (branch própria, único escritor) |
| `update_model.yml` | **manual apenas** (`workflow_dispatch`) | Sim, de `history` (mesmo tar.gz do item acima — só H2H, não tem nada de modelo/ledger) | Sim — roda os mesmos `model_*_props.js` | **Não.** Não re-empacota nem envia nada de volta pra `history`, e não inclui `odds_history/` no push pra `data` | `git checkout --orphan data-tmp; git rm -rf .; ...; git add -A; git push origin HEAD:data --force` — **destrutivo pra branch `data` inteira** |
| `update_mlb_early.yml` | **manual apenas** (`workflow_dispatch`) | Não | Sim (roda `model_mlb_props.js`) | Não — nunca menciona `odds_history/` | `git checkout --orphan data-mlb-early-tmp; git rm -rf .; ...; git add -A; git push origin HEAD:data --force` — **destrutivo pra branch `data` inteira**, com uma lista de re-fetch parcial de outros esportes (não inclui `odds_history/`, `ranking.json` nem os `*_props_results.json`) |

## 2. Um job pode sobrescrever arquivos de `odds_history` escritos por outro?

**Sim, e já aconteceu.** Ver seção 4. Mecanismo:

- `update_all.yml`, `update_player_stats.yml` e `update_tennis_ranking.yml` usam
  hoje o padrão seguro `git checkout -b data-work origin/data --force` (traz a
  branch `data` inteira pro working tree, sem apagar nada) + `git add` de uma
  lista específica + `git push` **sem** `--force`. Se outro processo já
  empurrou pra `data` nesse meio-tempo, esse `push` é rejeitado (non-fast-forward)
  e o step falha — perde a atualização daquela execução, mas **não corrompe**
  o que já estava lá.
- `update_model.yml` e `update_mlb_early.yml` fazem `git checkout --orphan ...
  ; git rm -rf . --quiet` (apaga literalmente tudo do working tree) e depois
  `git push ... --force`. Isso **substitui a branch `data` inteira** pelo que
  sobrar da lista curada de cada um — não importa o que outro workflow tenha
  commitado antes, nem se está rodando ao mesmo tempo. Não há checagem de
  "non-fast-forward": o `--force` ignora isso de propósito.

Ou seja: os três workflows automáticos não corrompem uns aos outros (na pior
hipótese, uma execução falha e não salva nada naquele dia). Os dois workflows
manuais **sempre** apagam a branch `data` inteira até a sua própria lista
curada — inclusive tudo que os workflows automáticos acumularam.

## 3. O histórico central particionado por esporte/mês sofre a mesma perda?

Sim, integralmente. Os arquivos `odds_history/model_ledger_<esporte>_<mês>.json`
são gravados pelos mesmos scripts `model_*_props.js`, dentro dos mesmos jobs de
`update_all.yml` (e de `update_model.yml`). Como nenhum dos dois workflows
inclui qualquer arquivo de `odds_history/` na etapa de salvar/commitar (ver
tabela acima), toda partição do ledger central escrita durante uma execução é
descartada quando o runner do GitHub Actions é encerrado — **hoje o histórico
central de indicações do modelo não sobrevive a uma única execução em
produção.** Confirmei isso nesta sessão: rodei `import_legacy_apostas.js`
localmente e ele criou `odds_history/model_ledger_*.json` normalmente — mas
esses arquivos existem só nesta máquina/sessão; uma execução real do GitHub
Actions produziria os mesmos arquivos e os perderia no mesmo run.

## 4. Evidência de arquivos que existiram e desapareceram

Com o ref `origin/data` atualizado (`git fetch origin data --force`):

- A branch `data` hoje tem **117 commits**, veio de um commit raiz (sem pai)
  `66c3c497` — `"data: 2026-07-02 19:41 UTC"` — contendo **só 3 arquivos**:
  `.gitignore`, `bets.json`, `tennis_player_stats.json`.
- O cache local desta sessão (anterior ao fetch) ainda apontava pro estado
  *antes* desse reset: um único commit `9069bc722af3` — `"data: 2026-05-02
  21:14 UTC"` — contendo **dezenas de arquivos**, incluindo
  `odds_history/hockey_nhl_model_2026-05.json`, `mlb_props.json`,
  `nba_props_pinnacle.json`, `nhl_props_results.json` e até `node_modules/`
  inteiro (evidência de um `git add -A` antigo, indiscriminado).
- Isso confirma que em algum momento entre 2/mai e 2/jul/2026 a branch `data`
  foi resetada via orphan+force (perdendo tudo, incluindo o único arquivo de
  `odds_history/` que já existiu nela), e resetada de novo em 2/jul (o commit
  raiz atual). Desde 2/jul, os 116 commits seguintes são todos lineares (nenhum
  outro commit sem pai) — ou seja, os três workflows corrigidos não voltaram a
  causar um reset completo — mas **nenhum deles nunca mais adicionou nada em
  `odds_history/`**, porque a correção do dia 2/jul (commit `9c904dc`, "fix:
  substituir orphan+force por checkout direto da branch data") não incluiu
  esse diretório na lista de arquivos re-adicionados — ela apenas parou a
  sangria, sem restaurar o que fazia parte dela.
- `git ls-tree -r --name-only origin/data` hoje retorna exatamente 10 arquivos:
  `.gitignore`, `bets.json`, `mlb_injuries_today.json`,
  `mlb_player_stats.json.gz`, `mlb_player_team.json`,
  `nba_player_stats.json.gz`, `nfl_player_stats.json.gz`,
  `nfl_player_team.json`, `ranking.json`, `tennis_player_stats.json`. Nenhum
  arquivo de `odds_history/`. (Os arquivos de NHL — fora de temporada desde
  jun/2026 — também não aparecem, consistente com o reset de 2/jul ter
  acontecido depois da última vez que o job de NHL rodou em temporada.)

## 5. Contexto histórico do próprio repositório sobre esse risco

O commit `3a1d0e8` (14/jun/2026 — **antes** da correção do padrão destrutivo em
9c904dc) já removeu o cron automático de `update_mlb_early.yml` e o disparo
automático de `update_model.yml` (que `odds_history.yml` fazia via API logo
após seu próprio commit diário), com a mensagem explícita "para evitar
duplicação e race condition na branch data". Ou seja: o próprio histórico do
projeto já reconhece esse risco de concorrência — mas a correção de 14/jun só
reduziu a *frequência* dos disparos (de automático para manual), sem tocar no
padrão orphan+force em si. A correção de 2/jul consertou o padrão em três
workflows e deixou justamente os dois que tinham acabado de virar
"manual-only" (`update_model.yml` e `update_mlb_early.yml`) intocados.

## 6. Conclusão

**Onde a perda ocorre hoje, garantidamente, toda execução:** `update_all.yml`
(o workflow de produção, que roda todo dia às 18:00 UTC) nunca inclui
`odds_history/` na etapa de empacotar artefatos nem na etapa de salvar na
branch `data`. Isso descarta, sem aviso, tanto os arquivos antigos
`*_model_<mês>.json` quanto as novas partições `model_ledger_*` a cada execução
diária. Esse é o mecanismo de perda ativo, contínuo, e é o que afeta o
histórico central de indicações agora.

**Onde a perda pode ocorrer sob demanda:** `update_model.yml` e
`update_mlb_early.yml` ainda usam `git checkout --orphan; git rm -rf .; git
add -A; git push --force`, o mesmo padrão que já causou pelo menos um reset
completo confirmado da branch `data` (2/jul/2026). Qualquer disparo manual de
um dos dois hoje apaga a branch `data` inteira — inclusive tudo que
`update_all.yml` vem acumulando diariamente (stats de temporada, `bets.json`,
mapas de time) — e a substitui pela lista curada de arquivos de cada um desses
dois workflows, que não inclui `odds_history/`, nem `ranking.json` (no caso do
MLB early), nem os arquivos `*_props_results.json`.

**Concorrência entre workflows automáticos:** não há corrupção cruzada — o
padrão seguro (`checkout -b data-work` + `push` sem `--force`) faz o segundo
push falhar em vez de sobrescrever, então o pior caso é perder a atualização
daquela execução específica, não os dados já commitados.

Nenhuma correção foi aplicada, conforme solicitado.
