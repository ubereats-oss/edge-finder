# Edge Finder — Codex Context

## Stack
- Flutter (Web/Android/iOS) + Firebase Firestore (`odds-app-edge`, `southAmericaEast`)
- Node.js pipeline + GitHub Actions (`ubereats-oss/edge-finder`)
- The Odds API (19 chaves rotacionadas, reset dia 1 de cada mês)

## Regras de código
- Fences: `~~~` nunca backticks
- Flutter: `const` obrigatório em decorators estáticos; `withValues` não `withOpacity`
- Todo texto do app em Português Brasileiro
- Git push: one-liner Node.js lendo `GITHUB_TOKEN` do `.env`
- Nunca usar `cd` sem necessidade; comandos nunca com quebra de linha

## Arquitetura
- `pipeline/` — scripts Node.js de coleta e modelo
- `lib/screens/` — telas Flutter
- `lib/services/api_service.dart` — leitura do Firestore via REST
- `lib/widgets/` — componentes reutilizáveis
- Branch `data` — JSONs persistidos (ratings, stats, teams, bets)
- Branch `history` — odds_history.tar.gz acumulado diariamente

## Firestore (`results/`)
- `nba_h2h` ← `nba_results.json`
- `nba_props` ← `nba_props_results.json`
- `nba_props_br` ← `nba_props_br_results.json`
- `mlb_h2h` ← `mlb_results.json`
- `mlb_props` ← `mlb_props_results.json`
- `tennis` ← `model_results.json`

## Workflows
- `update_model.yml` — sports: `nba_br`, `nba`, `mlb`, `tennis`, `all`
- `.github/workflows/odds_history.yml` — roda 19h UTC diariamente
- `update_player_stats.yml` — roda 10h UTC diariamente

## Arquivos críticos na branch `data`
`nba_rating.json`, `nba_player_team.json`, `nba_injuries_today.json`, `nba_boxscores_cache.json`, `mlb_team_rating.json`, `mlb_player_team.json`, `mlb_injuries_today.json`, `bets.json`, `nba_player_stats.json.gz`, `mlb_player_stats.json.gz`

## Regras de resposta
- Nunca perguntar o que acabou de ser pedido — executar
- Nunca afirmar sem certeza absoluta
- Nunca repetir diagnósticos já feitos
- Números de linha sempre referentes ao arquivo real, nunca ao repomix
