# Relatório — Actions Storage da conta e relação com os workflows

Data da investigação: 2026-09-06
Conta: `ubereats-oss` (usuário, não organização) — repositório `edge-finder`
Nenhuma correção foi aplicada — apenas investigação.
Convenção: cada número traz **[MEDIDO]** ou **[ESTIMADO]**.
Fonte das medições: API do GitHub via `gh api`, hoje (`gh auth status` confirma
sessão autenticada como `ubereats-oss`).

## 0. Lacuna de medição — sendo transparente

- O endpoint de billing (`users/ubereats-oss/settings/billing/actions`) voltou
  **404**: o token atual não tem o escopo `user` necessário. Não consegui
  confirmar via API o "100% de 0,5 GB" citado no pedido, nem ver o número
  exato que o GitHub mostra na tela de cobrança.
- **A cota de 500 MB de "Actions storage" é compartilhada com o GitHub
  Packages** (documentação oficial do GitHub, ver seção 3) — e listar pacotes
  exige escopo `read:packages`, que o token também não tem. **Não consegui
  medir o consumo de GitHub Packages da conta.** Isso é relevante: se a conta
  publica pacotes (npm, containers, etc.) em algum dos 30 repositórios, esse
  consumo entra na mesma cota e eu não tenho visibilidade sobre ele.
- Tudo abaixo é medido diretamente via API (`/actions/artifacts`,
  `/actions/caches`, `/actions/cache/usage`) em todos os 30 repositórios da
  conta, não só `edge-finder` — isso não exige os escopos que faltam.

## 1. Artefatos de workflow existentes hoje — [MEDIDO]

`GET /repos/ubereats-oss/edge-finder/actions/artifacts` — 15 artefatos:

| Nome | Execuções (últimos 5 dias) | Tamanho/execução (médio) | Retenção configurada | Expira |
|---|---|---|---|---|
| `mlb-out` | 5 | **3,53 MiB** | 1 dia | `created_at + 1 dia` exato em todas |
| `nfl-out` | 5 | 0,74 MiB | 1 dia | idem |
| `tennis-out` | 5 | ~0,002 MiB (1–2,7 KB) | 1 dia | idem |
| `nba-out` | 0 | — | — | NBA fora de temporada (não roda) |
| `nhl-out` | 0 | — | — | NHL fora de temporada (não roda) |

Somando os 15 artefatos listados hoje (`edge-finder`): **22,4 MiB** (a maioria
já com `expired:true`, ainda visível na API até a limpeza física do GitHub,
mas contando 0 contra a cota assim que expira de fato).

**Em toda a conta** (varri os 30 repositórios do usuário via API):
- `edge-finder`: 15 artefatos, 22,4 MiB.
- `QRCodeAlex`: 3 artefatos, 0,21 MiB.
- **Os outros 28 repositórios têm zero artefatos.**
- **Total de artefatos na conta inteira hoje: ~22,6 MiB.**

Isso é **~4,5% de uma cota de 500 MB** — não bate com "100%" citado no pedido.
Ver seção 4 (histórico da retenção) para uma explicação plausível, e seção 0
para a lacuna de medição (Packages).

## 2. Quais workflows/steps geram os maiores artefatos — [MEDIDO via código + API]

Só **`update_all.yml`** produz ou consome artefatos no repositório inteiro —
confirmado por busca em todos os `.github/workflows/*.yml`: nenhum outro
workflow (`update_model.yml`, `update_mlb_early.yml`, `update_player_stats.yml`,
`update_tennis_ranking.yml`, `odds_history.yml`) usa
`actions/upload-artifact` ou `actions/download-artifact`.

Dentro de `update_all.yml`, 5 jobs (um por esporte + tênis) empacotam um
artefato cada (`<esporte>-out`), consumido só pelo job `save-data` da mesma
execução:

| Job / step "Empacotar artefatos" | Maior arquivo dentro | Tamanho/execução |
|---|---|---|
| MLB → `mlb-out` | `mlb_player_stats.json.gz` (~3,6–3,8 MiB) + `mlb_props_results.json` + team/injuries | **3,53 MiB (medido)** — o maior hoje |
| NFL → `nfl-out` | `nfl_player_stats.json.gz` (~0,74 MiB) + resultados/team | 0,74 MiB (medido) |
| Tênis → `tennis-out` | `model_results.json` (pipeline de tênis descontinuado, quase vazio) | ~0,002 MiB (medido) |
| NBA → `nba-out` | `nba_player_stats.json.gz` — **~5,1–6 MiB medido na branch `data`** (ver relatório de espaço do repositório) | fora de temporada hoje, mas seria o **maior de todos** quando ativo — [ESTIMADO por extrapolação do arquivo medido] |
| NHL → `nhl-out` | `nhl_player_stats.json.gz` — sem medição atual (fora de temporada, arquivo não existe na branch `data` hoje) | [ESTIMADO] provavelmente 2ª ou 3ª posição, na faixa de 3–5 MiB por analogia ao padrão de NBA/MLB |

## 3. Política de retenção — [MEDIDO]

- Todo artefato listado tem `expires_at` = `created_at` + exatamente 1 dia,
  confirmando que a configuração `retention-days: 1`, presente nas 5 etapas
  `actions/upload-artifact@v4` de `update_all.yml`, está de fato em vigor.
- **Não é o padrão de 90 dias.** É um override explícito de 1 dia — abaixo
  do padrão do GitHub para retenção de artefato/log (90 dias, ajustável de 1
  a 90 no nível da conta/organização).
- Não existe endpoint de API pra ler a configuração padrão de retenção do
  repositório (é só via tela de Settings), mas isso é irrelevante na prática:
  como toda etapa que gera artefato já sobrescreve com `retention-days: 1`
  explicitamente, o padrão do repositório nunca chega a ser aplicado a esses
  artefatos.
- **Achado histórico relevante:** `retention-days: 1` foi adicionado em
  **02/ago/2026** (commit `321ec02`), e antes dessa data **não havia nenhuma
  configuração de retenção** no workflow — ou seja, todo artefato gerado até
  01/ago/2026 usava o padrão do GitHub (tipicamente 90 dias). Isso é uma
  explicação plausível pro "100% de 0,5 GB" citado no pedido: antes da
  correção de 02/ago, os artefatos diários (~4–5 MiB por execução completa)
  se acumulavam por até 90 dias em vez de 1 — potencialmente **90x mais
  volume acumulado simultaneamente** do que o padrão atual permite. A medição
  de hoje (15 artefatos, todos de 01–05/set) sugere que os artefatos antigos
  de retenção longa já foram todos removidos/expirados — a cota, se estava
  cheia por causa disso, já deveria estar se esvaziando.

## 4. Artefato retido além do necessário? — [MEDIDO]

Não. A única função dos artefatos aqui é transportar arquivos entre os jobs
por esporte e o job `save-data` **da mesma execução** — e a retenção de 1 dia
já é o mínimo que a API do GitHub aceita (`retention-days` não aceita 0).
Não há uso de artefato pra nenhum outro fim (não é usado como backup, não é
baixado por humanos, não alimenta outro workflow). A configuração atual está
alinhada com o que o pedido descreve como necessário.

## 5. Consumo de cache — [MEDIDO], separado dos artefatos

`GET /repos/ubereats-oss/edge-finder/actions/cache/usage`:
```json
{"active_caches_size_in_bytes": 33161590, "active_caches_count": 2}
```
- `npm-firebase-Linux`: 17,55 MiB (criado 20/ago, último acesso 05/set)
- `npm-axios-Linux`: 15,61 MiB (criado 21/ago, último acesso 05/set)
- **Total: 31,63 MiB.**

Isso é **cobrado à parte** da cota de 500 MB de artefatos — cache tem cota
própria de **10 GB por repositório**, não compartilhada com Packages nem com
artefatos (confirmado na documentação oficial do GitHub). `edge-finder` usa
~0,3% dessa cota de 10 GB. Não há risco aqui.

## 6. Estimativa: incluir `odds_history/` nos artefatos por esporte — [ESTIMADO]

Baseado no crescimento mensal projetado no relatório anterior (histórico
central de indicações, 900 bytes/registro medido, volume/dia estimado por
esporte):

| Esporte | MiB acumulado no fim do mês (partição do mês corrente, pico) | MiB médio no meio do mês |
|---|---|---|
| NBA | 1,67 | 0,84 |
| MLB | 2,35 | 1,18 |
| NHL | 1,25 | 0,63 |
| NFL | 0,60 | 0,30 |

Premissa: só a partição do **mês corrente** de cada esporte precisaria viajar
no artefato diário (meses fechados já estariam persistidos e não
precisariam ser recarregados a cada execução) — o valor cresce de ~0 no
início do mês até o pico acima no fim do mês, e reinicia no mês seguinte.

Impacto relativo no tamanho de cada artefato (usando os tamanhos medidos hoje
como base — seção 1/2):
- `mlb-out`: 3,53 MiB → **3,83–5,88 MiB** (+9% a +67%, meio do mês a fim do mês)
- `nfl-out`: 0,74 MiB → **1,04–1,34 MiB** (+41% a +81%)
- `nba-out`/`nhl-out`: sem baseline medido hoje (fora de temporada), mas pela
  mesma lógica, incremento absoluto semelhante (~0,6–1,7 MiB)

Em termos absolutos, mesmo somando o pico simultâneo dos 4 esportes (cenário
de outubro, todos em temporada): **+5,9 MiB no total de artefatos daquele
dia** — contra uma cota de 500 MB, é um acréscimo de ~1,2 puntos percentuais
no pior caso, e some-se que os artefatos já expiram em 1 dia. **Não representa
risco de estourar a cota de artefatos.**

## 7. Conclusão

- **Medido hoje:** artefatos da conta inteira somam ~22,6 MiB (4,5% da cota de
  500 MB); cache de `edge-finder` soma ~31,6 MiB (0,3% de uma cota separada de
  10 GB). Nenhum dos dois bate com "100% de 0,5 GB".
- **Não medido:** consumo de GitHub Packages (compartilha a mesma cota de 500
  MB dos artefatos) — token sem escopo `read:packages`; e o número exato de
  billing da conta — token sem escopo `user`. Se a cota realmente está em
  100%, o mais provável, dado o resto da medição, é que o consumo esteja em
  Packages, não em artefatos de Actions.
- **Explicação histórica plausível para o alerta:** até 01/ago/2026, os
  artefatos de `update_all.yml` não tinham `retention-days` configurado (ficavam
  no padrão de até 90 dias do GitHub) — uma correção em 02/ago/2026 (commit
  `321ec02`) baixou isso pra 1 dia. Se o alerta de 100% é anterior a essa
  correção, ele já deveria estar se resolvendo sozinho.
- **A retenção de 1 dia já está no mínimo aceito pela API e é apropriada** pro
  papel dos artefatos aqui (só transporte entre jobs da mesma execução) — não
  há retenção além do necessário.
- **Incluir `odds_history/` nos artefatos por esporte é uma mudança pequena**:
  entre +0,3 e +2,35 MiB por execução por esporte (estimado), picos
  simultâneos somando ~5,9 MiB/dia no cenário de outubro — não ameaça a cota
  de 500 MB de artefatos nem a de 10 GB de cache.

Nenhuma correção foi aplicada, conforme solicitado.
