# Edge Finder

## Sobre o projeto
App Flutter + Firebase que identifica oportunidades de apostas esportivas (edges) comparando odds entre casas. Integra pipeline Node.js que coleta odds/props de NBA, MLB, NHL, Tênis via APIs e calcula modelos de probabilidade. GitHub Actions automatiza coleta diária, backtesting e atualização de dados para Firestore.

## Mapa do projeto

### Telas (lib/screens/)
- `sport_selector_screen.dart` — seletor inicial de esportes
- `basketball_screen.dart`, `basketball_br_screen.dart` — partidas NBA e basquete BR
- `baseball_screen.dart` — partidas MLB
- `hockey_screen.dart` — partidas NHL
- `football_screen.dart` — partidas futebol
- `tennis_screen.dart` — partidas tênis
- `mix_screen.dart` — resultados consolidados múltiplos esportes
- `bets_screen.dart` — histórico de apostas
- `bet_planner_screen.dart` — planejador de apostas
- `add_late_bet_screen.dart` — adicionar apostas tardias
- `player_detail_screen.dart` — detalhes e estatísticas de jogador
- `settings_screen.dart` — configurações e preferências

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
- **Análise**: `backtest_*_props.js`, `model_prob.js`
- **Sincronização**: `firebase_sync.js`, `save_odds_history.js`, `get_tennis_ranking.js`

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
