# Edge Finder

## Sobre o projeto
App Flutter + Firebase que identifica oportunidades de apostas esportivas (edges) comparando odds entre casas. Login e-mail/senha restrito a uma única conta (lib/auth_config.dart) — e-mail diferente ou não verificado veem tela de acesso negado / verificação pendente.

**Modelos próprios (NBA/MLB/NHL/NFL) encerrados** — jobs/workflows desativados (`if: false`, não apagados, ver `update_all.yml`/`update_model.yml`/`update_mlb_early.yml`/`update_player_stats.yml`), telas Mix de Apostas e por esporte sem acesso a partir da tela inicial (código mantido, só desconectado). Continuam funcionando: referência da Pinnacle, captura de odd de fechamento e "Conferir odds" (comparação manual contra casas PT licenciadas).

## Mapa do projeto

### Telas (lib/screens/)
- `sport_selector_screen.dart` — tela inicial (só ícones de Minhas Apostas/Desempenho/Conferir odds/Settings — modelos encerrados)
- `basketball_screen.dart`, `basketball_br_screen.dart`, `baseball_screen.dart`, `hockey_screen.dart`, `football_screen.dart`, `mix_screen.dart` — telas de indicação por esporte e Mix de Apostas; código mantido, sem acesso a partir da tela inicial (modelos próprios encerrados)
- `auth_gate.dart` — roteia entre login, verificação de e-mail, acesso negado e app
- `login_screen.dart` — login e-mail/senha
- `verify_email_screen.dart` — pede confirmação do e-mail antes de liberar o app
- `access_denied_screen.dart` — bloqueio de contas não autorizadas
- `bets_screen.dart` — histórico de apostas
- `bet_planner_screen.dart` — planejador de apostas
- `add_late_bet_screen.dart` — adicionar apostas tardias
- `player_detail_screen.dart` — detalhes e estatísticas de jogador
- `settings_screen.dart` — configurações e preferências
- `model_performance_screen.dart` — desempenho do modelo por esporte/mercado/faixa de edge
- `conferir_odds_screen.dart` — confere odds de casas PT licenciadas contra a probabilidade justa da Pinnacle
- `pt_value_report_screen.dart` — relatório "Valor real nas casas que posso usar"
- `placard_opportunities_screen.dart` — oportunidades automáticas Placard × Pinnacle e CLV acumulado; preços acima de 120s são sinalizados como antigos.

### Serviços (lib/services/)
- `api_service.dart` — integração com Firestore REST e GitHub Actions
- `edge_evaluator_service.dart` — cálculo de edges (prob. vs odds)
- `prefs_service.dart` — persistência local (shared_preferences)

### Widgets (lib/widgets/)
- `match_card.dart` — card de partida
- `prop_card.dart`, `mlb_prop_card.dart` — cards de prop
- `edge_evaluation_sheet.dart` — avaliação de edge e probabilidades
- `bet_dialog.dart` — diálogo criar/editar aposta
- `props_filter_bar.dart` — filtro de props por critérios
- `status_bar.dart`, `last_updated_bar.dart` — barras de status/atualização

### Utilitários (lib/utils/)
- `file_saver.dart`, `file_saver_*.dart` — exportar PDF/Excel multiplataforma

### Pipeline Node.js (pipeline/)
- **Coleta odds**: `get_nba_odds.js`, `get_mlb_odds.js`, `get_nhl_props.js`, `get_tennis_props.js`
- **Coleta props**: `get_nba_props.js`, `get_nba_props_br.js`, `get_mlb_props.js`
- **Modelos**: `model_nba.js`, `model_mlb.js`, `model_nhl_props.js`, `model_tennis_props.js`
- **Dados jogadores**: `get_*_player_teams.js`, `get_*_player_stats.js`, `get_*_injuries.js`
- **Análise**: `backtest_*_props.js`, `model_prob.js`, `backtest_calibration_methods.js` (valida calibração antiga vs nova por Brier/log-loss)
- **Sincronização**: `firebase_sync.js`, `save_odds_history.js`, `get_tennis_ranking.js`
- **Conferir odds (casas PT vs Pinnacle)**: `get_pinnacle_reference.js` (odds da Pinnacle H2H+props, próximas 24h, probabilidade justa por método de potência), `sync_pt_odds_checks.js` (conferências marcadas como feitas → histórico central), `generate_pt_value_report.js` (relatório "Valor real nas casas que posso usar"), `test_pt_odds_e2e.js` (teste de ponta a ponta simulado, sem rede nem Firebase)
- **Placard automático**: `get_placard_odds.js` (Playwright; sete competições; DOM observado), `placard_aliases.json` (apelidos validados contra os dois nomes e horário do evento), `placard_value.js` (preço justo sem margem; mínima justa ×1,01; Kelly central), `run_placard_value.js` (leitura a cada 30min; Pinnacle atualizada só ao entrar/variar seleção a até 3% da mínima, ou com preço acima de 2h e jogo nas próximas 3h; oportunidade só após nova cotação Pinnacle; fechamento na mesma linha nos 5min finais). `closingOddsScheduler` dispara leitura pelo workflow_dispatch a cada 30min e verifica fechamentos a cada minuto; `placard_value.yml` não usa cron. Totais alternativos são consultados apenas para a linha exata quando necessário. Dados privados no Firestore: `_placard_opportunities`, `_placard_reads`, `_placard_control`, `_placard_pinnacle_latest`, `_placard_refresh_state`. App lê `results/placard_current` e páginas de sua geração; regras existentes já restringem a leitura ao dono.
- **Cota mensal**: `odds_api_monthly_budget.js`, integrado ao cliente compartilhado, reserva transacionalmente antes de cada chamada em Actions: teto 4.000/mês UTC, até 1.736 para leitura (inclui legado) e restante reservado ao fechamento Placard. Na primeira chamada paga de cada mês, consulta o catálogo gratuito por chave e soma os headers de consumo já ocorrido; sem esses headers bloqueia a chamada. Custo incerto/falha de rede mantém reserva; custo inesperado bloqueia novas chamadas. Demais consumidores do cliente sem credencial Firebase ficam bloqueados. Não alterar risco para liberar cota.
- **CLV Placard**: uma amostra por evento/mercado/linha/lado (primeira oportunidade); última Pinnacle pré-jogo efetivamente observada nos 5min finais, probabilidade sem margem, CLV = odd Placard × probabilidade de fechamento − 1. Nunca usar preço pós-início ou outra linha. Totais inteiros usam probabilidade/vantagem condicional a não haver devolução; quartos são excluídos. O relatório mostra taxa de fechamento capturado entre as oportunidades já finalizadas e separa pendentes. IC95 bootstrap por evento preserva correlação; confirmado apenas com n≥100 e limite inferior>0. Não equivale a garantia do último tick do mercado.

Tênis foi excluído do app — automação desativada (cron de `update_tennis_ranking.yml` e job `tennis` de `update_all.yml`), mas scripts e dados já gravados continuam intactos.

### Backend
- `functions/` — Cloud Functions Firebase

## Comandos

### Flutter
- `flutter pub get` — baixar dependências
- `flutter analyze` — análise estática (lint)
- `flutter test` — executar testes
- `flutter build web` — build para web
- `flutter run` — rodar em dispositivo/emulador

### Node.js
- `npm install` — instalar dependências
- `node pipeline/<script>.js` — executar script específico

## Regras de implementação
- Ao alterar um componente, função ou modelo, localizar e atualizar TODOS os pontos de uso no projeto.
- Seguir o estilo visual e os padrões já existentes nas telas — nunca introduzir padrão novo sem ser pedido.
- Fazer apenas o que foi pedido: não refatorar, renomear ou "melhorar" código fora do escopo da tarefa. Pode corrigir warnings do analyze se for rodado
- NÃO rodar `flutter analyze`, nem deploy, nem commit, ne push — quem roda é o usuário, para economizar tokens. Só rodar se for explicitamente pedido. Sempre avisar se precisar fazer deploy e indicar o comando completo
- Cloud Functions só são publicadas pelo workflow GitHub Actions "Mirror Checks and Functions Deploy". Mudança em `functions/` vai por commit e push na `main`; o deploy acontece automaticamente. Para republicar sem mudança de código, usar o disparo manual desse workflow. Nunca rodar `firebase deploy` de Functions na máquina local.
- `firestore.rules` é publicado só localmente (`firebase deploy --only firestore:rules`, login pessoal já existente na máquina) — a service account de CI não tem (e não deve ganhar) permissão `firebaserules.admin`. O job "Deploy Firestore rules (manual)" no mesmo workflow é só um caminho alternativo opcional via `workflow_dispatch` com `force_firestore_rules_deploy=true`; nunca roda em push normal.
- `GH_DISPATCH_TOKEN` no Secret Manager deve ser o fine-grained PAT `edge-finder-functions`, sem expiração, restrito ao repositório `ubereats-oss/edge-finder`, com `Actions` e `Contents` em leitura/escrita. Se for revogado/desativado, `syncOddsBr` deixa de gravar substituições/remoções no histórico central da branch `data` e `closingOddsScheduler` deixa de disparar a captura de odd de fechamento.
- Testes e comparações antes/depois nunca devem chamar a The Odds API real. Usar somente dados já salvos, fixtures ou logs. Só chamar a The Odds API quando o usuário pedir explicitamente na mensagem atual.
- Chaves da The Odds API nunca devem ficar hardcoded no repositório. Workflows devem ler o segredo `THE_ODDS_API_KEYS` (uma chave por linha), mascarar cada chave individualmente e exportar `ODDS_API_KEY`, `ODDS_API_KEY_2`... para os scripts. `ODDS_API_KEYS` existe só como fallback temporário.
- Enquanto a cota da The Odds API estiver baixa, prioridade de uso: 1) captura de odd de fechamento para CLV; 2) coleta diária; 3) `odds_history` suspenso. Toda chamada pulada por reserva de cota deve ficar registrada no log.
- Respostas curtas: reportar o que foi feito em poucas linhas, sem explicar o código.
- Ao criar, mover ou remover telas/arquivos principais, atualizar a seção "Mapa do projeto" deste CLAUDE.md.

## Modo de operação com o programador

- Usuário não é programador — dar instruções claras e inequívocas.
- Usuário não usa PowerShell, usa CMD.
- NUNCA ser prolixo. Sempre ser direto, objetivo e conciso
- NUNCA querer me agradar - falar sempre a verdade e emitir sua opinião
- SEMPRE trazer a melhor solução possível - NUNCA trazer uma solução e depois sugerir melhorias, já incorporar TODAS as melhorias possíveis
## REGRA DE BOM SENSO 
	- Antes de responder, perguntar: "Isso faz sentido para quem vai receber?" - Se a resposta for não ou talvez — reformular antes de enviar.
	- Se os erros se repetirem, a abordagem não está funcionando. Existe uma alternativa diferente para solucionar?
- REGRAs DE RESPOSTA 
	- sempre que enviar algo que será copiado, colocar em caixa de código usando ~~~ como fence e não use nenhum outro marcador de código dentro da caixa.
	- não colocar na tela o desenvolvimento da solução - apenas a solução
	- Sempre antes de devolver usa solução, "se pergunte": "tenho certeza?" só depois de ter certeza traga a resposta. 
	- Nunca perguntar algo que já pode ser inferido pelo contexto
	- Antes de responder, verificar cada elemento contra as regras estabelecidas
- REGRA DE CONFIABILIDADE: Nunca afirme algo que não tenha certeza absoluta. Se não souber, diga "não sei" ou "não tenho certeza". Jamais chute ou suponha — mesmo que isso signifique não responder.
