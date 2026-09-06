# Relatório — Consumo de espaço do repositório e projeção do histórico central

Data da investigação: 2026-09-06
Nenhuma correção foi aplicada — apenas investigação.
Convenção: cada número traz **[MEDIDO]** ou **[ESTIMADO]**.

## 0. Nota metodológica importante

O clone local usado nesta investigação tinha refs desatualizados de sessões
anteriores, incluindo duas branches que **só existem localmente** (`data-clean`,
`data-tmp2` — não estão no GitHub; `git ls-remote origin` não as lista) e um
ref local `data` divergente do `origin/data` real. Rodei `git fetch --all
--force` e, a partir daí, toda medição de "o que está no GitHub" usa
exclusivamente `git rev-list --objects --remotes=origin` (ou seja, só
`origin/main`, `origin/data`, `origin/history`) — não `--all`, que incluiria as
branches locais órfãs e daria um número maior do que o que está realmente
hospedado.

## 1. Tamanho atual do repositório — [MEDIDO]

```
git count-objects -vH
  size (solto):      97.78 MiB
  size-pack:        269.29 MiB
  total (.git):     371 MiB
```
`du -sh .git` confirma: **371 MiB**. Esse é o número que conta pros limites do
GitHub (ver seção 7).

Árvore atual (conteúdo do último commit, não histórico) de cada branch:
- `origin/main`: **3.98 MiB** (76 commits) — código-fonte, saudável.
- `origin/data`: **11.18 MiB** — ver tabela por arquivo na seção 4.
- `origin/history`: **1.18 MiB** (um único arquivo, `odds_history.tar.gz`).

O diretório de trabalho local (fora do `.git`) tem ~1,5 GiB, mas quase tudo é
gitignorado (`node_modules/`, `build/`, `*.json` de stats descompactados,
`odds_history/` local) — não conta pro tamanho do repositório no GitHub.
Confirmado via `git check-ignore -v`.

## 2. Maiores objetos já commitados (qualquer commit, `origin/*`) — [MEDIDO]

Usando `git rev-list --objects --remotes=origin` + `git cat-file --batch-check`,
753 blobs únicos somam **728,8 MiB** de conteúdo bruto (antes da compressão de
pacote do git). Por categoria:

| Categoria | Tamanho total | Nº de blobs |
|---|---|---|
| `*_player_stats.json.gz` (snapshots de stats) | **693,16 MiB** | 179 |
| Outros (`tennis_player_stats.json`, 2 arquivos `.xml` avulsos) | 31,08 MiB | 129 |
| Mapas de time/lesão/rating (`*_player_team.json` etc.) | 1,67 MiB | 66 |
| Código do app (`lib/`) | 1,16 MiB | 83 |
| Docs/config (`.md`, `.dart`, `.js`, `.yml`) | 1,12 MiB | 221 |
| Código do pipeline (`pipeline/`) | 0,61 MiB | 75 |

**`node_modules/` e `odds_history/` não aparecem nessa lista — não existe
nenhum blob desses caminhos alcançável a partir de `origin/main`, `origin/data`
ou `origin/history` hoje.** Eles só existem nas duas branches locais órfãs
(`data-clean`, `data-tmp2`, nunca enviadas ao GitHub) e em commits antigos que
não são mais ancestrais de nenhuma branch remota atual (confirmado com
`git merge-base --is-ancestor 13faaa2 origin/data` → não é ancestral).

Os dois maiores blobs individuais, com commit de origem confirmado:

| Tamanho | Arquivo | Commit | Data |
|---|---|---|---|
| 10,81 MiB | `mlb_player_stats.json.gz` | `aaeaf40` | 2026-07-03 12:47 UTC |
| 5,98 MiB | `nba_player_stats.json.gz` | `ce7d0f6`→commit `aaeaf40` | 2026-07-03 12:47 UTC |

Note-se que **179 versões diferentes** desse mesmo par de arquivos (nba/mlb
`player_stats.json.gz`) já foram commitadas — cada execução diária do
workflow de stats grava uma cópia inteira nova, nunca um incremento.

## 3. A suspeita sobre dependências (node_modules) — [MEDIDO, refutada para o estado atual]

`node_modules/` foi commitado **uma única vez**, no commit `13faaa2` ("data:
2026-04-11 22:37 UTC"), somando 71,52 MiB — mas **esse commit não é ancestral
de nenhuma branch hoje hospedada no GitHub** (só existe numa branch local
órfã desta máquina). Ou seja: mesmo se esse incidente causou dor no passado,
ele já não pesa no repositório atual — foi eliminado num reset anterior.

Em contraste, o padrão `*_player_stats.json.gz` está ativo, presente em
`origin/data` hoje, e continua crescendo a cada execução (65 commits "stats:"
entre 2/jul e 5/set/2026, todos ainda na branch). **A causa do inchaço
histórico não são as dependências — são os arquivos de dados, especificamente
snapshots completos de stats recompactados do zero a cada execução.**

Causa técnica observada: muitos blobs de `nba_player_stats.json.gz` têm
exatamente o mesmo tamanho (5.117.603 bytes) em commits semanais diferentes
(21/jul, 28/jul, 15/ago, 1/set) — sugerindo que o conteúdo por trás não mudou
(fora de temporada), mas o blob é recriado do zero mesmo assim. Isso é
consistente com `gzip` embutir um timestamp no cabeçalho do arquivo por
padrão: mesmo com o JSON de entrada idêntico byte a byte, a saída comprimida
muda a cada execução, e o Git não consegue deduplicar. Isso é uma observação
técnica, não uma correção — nada foi alterado.

## 4. Tamanho atual por arquivo — branch `data` e branch `history` — [MEDIDO]

**`origin/data`** (via `git ls-tree -r -l`):

| Arquivo | Tamanho |
|---|---|
| `nba_player_stats.json.gz` | 5.117.603 B (4,88 MiB) |
| `mlb_player_stats.json.gz` | 3.792.449 B (3,62 MiB) |
| `tennis_player_stats.json` | 1.893.158 B (1,81 MiB) |
| `nfl_player_stats.json.gz` | 777.479 B (0,74 MiB) |
| `nfl_player_team.json` | 96.036 B |
| `mlb_player_team.json` | 32.657 B |
| `ranking.json` | 7.494 B |
| `bets.json` | 1.801 B |
| `mlb_injuries_today.json` | 40 B |
| `.gitignore` | 14 B |
| **Total** | **11,18 MiB** |

(`nhl_player_stats.json.gz`/`nhl_player_team.json` ausentes — NHL fora de
temporada desde jun/2026, sem execução desde então pra recriá-los após o
reset de 2/jul.)

**`origin/history`** (tar.gz único, `save_odds_history.js`): 1.235.994 bytes
(1,18 MiB) comprimido, **31,56 MiB descompactado**, 86 arquivos — todos
datados de abril/2026 (o conteúdo não muda desde então, apesar do workflow
rodar diariamente; isso é um sintoma de outro problema — provavelmente
`save_odds_history.js` parado ou falhando silenciosamente — fora do escopo
deste relatório, só registro o fato).

## 5. Projeção de crescimento do histórico central de indicações — [ESTIMADO]

Não há execução real em produção ainda (ver relatório anterior sobre
persistência) — não existe medição de volume diário real. A estimativa abaixo
usa o tamanho de registro **medido** nos arquivos gerados localmente nesta
sessão e um volume de indicações/dia **estimado**.

**Tamanho por registro — [MEDIDO]:** os arquivos `model_ledger_*.json`
gerados localmente (importação do histórico legado) têm em média **908
bytes/registro** (31.793 bytes / 35 registros). Um registro totalmente
preenchido (como o modelo grava, com `bookmaker`, `edge`, `kelly` etc. não
nulos) mede **841 bytes**. Uso **900 bytes/registro** como base.

**Volume de indicações avaliadas por dia por esporte, em temporada —
[ESTIMADO]:** premissas explícitas (nº de jogos/dia típico × combinações
jogador+mercado com Over/Under válido que passam nos filtros de qualidade de
dado hoje existentes no modelo):

| Esporte | Indicações/dia (estimativa central) | Faixa (baixa–alta) | Meses em temporada |
|---|---|---|---|
| NBA | 64 | 40–100 | out–abr (7 meses) |
| MLB | 90 | 50–140 | mar–out (8 meses) |
| NHL | 48 | 30–80 | out–mai (8 meses) |
| NFL | 23 | 12–40 | set–fev (6 meses) |

Meses em que os 4 esportes ficam em temporada **simultaneamente**: só
**outubro** (pico). Novembro a abril têm 3 esportes simultâneos; maio e
setembro têm 2; junho a agosto só MLB.

**Crescimento mensal do histórico central por mês do ano — [ESTIMADO,
cenário central]:**

| Mês | Esportes ativos | Indicações/dia | MiB/mês |
|---|---|---|---|
| Jan | NBA, NHL, NFL | 135 | 3,5 |
| Fev | NBA, NHL, NFL | 135 | 3,5 |
| Mar | NBA, MLB, NHL | 202 | 5,3 |
| Abr | NBA, MLB, NHL | 202 | 5,3 |
| Mai | MLB, NHL | 138 | 3,6 |
| Jun | MLB | 90 | 2,4 |
| Jul | MLB | 90 | 2,4 |
| Ago | MLB | 90 | 2,4 |
| Set | MLB, NFL | 113 | 3,0 |
| **Out (pico, 4 esportes)** | NBA, MLB, NHL, NFL | **225** | **5,9** |
| Nov | NBA, NHL, NFL | 135 | 3,5 |
| Dez | NBA, NHL, NFL | 135 | 3,5 |

## 6. Projeção acumulada em 1 e 3 anos — [ESTIMADO]

| Cenário | 1 ano | 3 anos |
|---|---|---|
| Baixo | 25,9 MiB | 77,8 MiB |
| **Central** | **44,2 MiB** | **132,5 MiB** |
| Alto | 70,5 MiB | 211,6 MiB |

Isso é o tamanho **bruto em texto** (soma do que cada partição JSON pesa em
disco). O tamanho real **empacotado no Git** tende a ficar bem abaixo disso:
diferente do `.gz` de stats (seção 3), as partições do ledger são texto puro
que cresce por acréscimo dentro do mesmo arquivo — o mecanismo de delta do Git
comprime muito bem versões sucessivas de um arquivo que só ganha linhas no
fim. Não medi a taxa de compressão real (não há histórico de produção ainda),
mas é razoável esperar que o custo real em `.git` fique numa fração desses
valores brutos — mesmo no cenário alto (211,6 MiB brutos em 3 anos), o
histórico central projetado fica **muito abaixo** dos 693 MiB que só os
snapshots de stats já ocupam hoje em menos de 3 meses.

## 7. Limite de tamanho — distância — [MEDIDO + documentado pelo GitHub]

Documentação oficial do GitHub (`docs.github.com`, "About large files on
GitHub"):
- Arquivo individual: aviso acima de 50 MiB, bloqueio acima de 100 MiB.
- Repositório: "ideal" abaixo de 1 GiB, "fortemente recomendado" abaixo de 5
  GiB — acima disso o GitHub pode entrar em contato pedindo ação corretiva.

Medido hoje:
- Maior arquivo individual já commitado: 10,81 MiB — **10x abaixo** do limite
  de aviso (50 MiB), **~9x abaixo** do bloqueio (100 MiB).
- Repositório inteiro (`.git`): **371 MiB** — **~27% do limite "ideal" de 1
  GiB** (faltam ~653 MiB pra chegar lá), **~7% do teto "fortemente
  recomendado" de 5 GiB**.

**Nenhum limite documentado do GitHub está sendo atingido hoje.** O
repositório está confortavelmente dentro da faixa "ideal". Dito isso, o
padrão de crescimento observado (693 MiB em ~2 meses só de stats.gz, com
histórico linear preservado desde 2/jul) é uma trajetória que, se mantida sem
nenhuma poda de histórico, cruzaria 1 GiB em poucos meses e continuaria
crescendo indefinidamente — o histórico central de indicações projetado
(seção 6) é uma fração pequena desse crescimento, não o fator dominante.

## 8. Conclusão

- A suspeita de que dependências (`node_modules`) causaram o inchaço que
  motivou o reset de 2/jul é **refutada para o estado atual do repositório**:
  esse commit existe só numa branch local nunca enviada ao GitHub, não é
  ancestral de nada hospedado hoje, e mesmo historicamente foi um incidente
  único de 71,5 MiB — bem menor que os 693 MiB que os snapshots de stats já
  acumularam desde então.
- A causa real, medida e ativa hoje, é o padrão de **recommitar o arquivo de
  stats inteiro, comprimido do zero, a cada execução diária**, sem nunca podar
  o histórico — 179 versões diferentes desses arquivos já existem, crescendo
  ~11 MiB por execução completa dos 4 esportes.
- O histórico central de indicações (ledger), na pior estimativa razoável,
  cresceria menos de 220 MiB em 3 anos — uma fração do que os snapshots de
  stats já consomem em menos de 3 meses. Ele não é hoje, nem projetado, um
  risco de espaço comparável.
- Nenhum limite de tamanho do GitHub está sendo atingido ou está próximo de
  ser atingido; o repositório usa ~27% do teto "ideal" documentado.

Nenhuma correção foi aplicada, conforme solicitado.
