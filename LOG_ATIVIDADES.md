# Log de atividades — Edge Finder

As entradas são acrescentadas somente ao final. Não registrar tokens, chaves ou senhas.

## 2026-10-23 — Parte 0: log de atividades

- Início: 06:00:18 (relógio do Windows).
- Fim do aceite: 06:01:49 (relógio do Windows); publicação registrada no commit desta parte.
- Pedido recebido: criar o log e exigir o registro de cada tarefa ao terminar.
- O que foi feito: criado este log e adicionada a regra de registro em `AGENTS.md`.
- Arquivos alterados: `AGENTS.md`, `LOG_ATIVIDADES.md`.
- Commit: commit da Parte 0 na `main` (identificado pelo histórico Git; o arquivo não pode conter o hash do próprio commit).
- Resultado do aceite: 1 regra e 1 arquivo presentes; teste de leitura/asserção passou. Evidência: teste Node.js executado às 06:01 e conteúdo dos dois arquivos neste commit.
- Problemas encontrados: primeiro teste falhou por interpretação de crases pelo PowerShell; a verificação foi corrigida e passou. Arquivos locais preexistentes foram preservados.
- Pendências: nenhuma da Parte 0.

## 2026-10-23 — Parte 1: cota da The Odds API

- Início: 06:04:40 (relógio do Windows).
- Fim: 06:07:28 (relógio do Windows).
- Pedido recebido: verificar a exposição de chaves no repositório público e histórico antes de alterar o limite de leituras.
- O que foi feito: comparadas 19 chaves locais distintas com 1.782 blobs de texto entre 4.180 objetos alcançáveis pelas referências remotas públicas, sem imprimir os valores. A execução parou ao encontrar correspondências literais.
- Arquivos alterados: somente `LOG_ATIVIDADES.md` nesta cópia de trabalho; nenhuma alteração na lógica da cota.
- Commit: nenhum da Parte 1; a condição de parada impediu a implementação e a publicação desta parte.
- Resultado do aceite: não passou pelo requisito de sigilo. Treze das 19 chaves locais aparecem no histórico público. Evidências: blob `e5ef480654b3a020965da60a6f41edc355972d2c` em `pipeline/save_odds_history.js`, introduzido no commit `2315194` e removido da versão corrente em `01bd506`; blob `81ca547c922bee565ba4d581e658ed6d5c965018` em `pipeline/get_nba_props.js` também pertence ao histórico de `origin/main`.
- Problemas encontrados: exposição histórica de chaves; removê-las da versão corrente não as apaga dos commits antigos.
- Pendências: limite da cota não alterado; Partes 2 a 8 não iniciadas.

## 2026-10-23 — Retomada da Parte 1: cota e chaves da The Odds API

- Início: 06:27:02 (relógio do Windows).
- Fim do aceite: 06:37:21 (relógio do Windows).
- Pedido recebido: guardar as 19 chaves em segredos, usar saldo real acima da reserva de 1.000 créditos, identificar uso externo por chave e validar uma comparação nova do Placard.
- O que foi feito: configurados os segredos `THE_ODDS_API_KEYS` no GitHub e no Firebase; preparadas localmente a lógica de saldo, a medição por chave e o resumo; executados 32 testes e uma leitura real do Placard.
- Arquivos alterados: `pipeline/odds_api_client.js`, `pipeline/odds_api_monthly_budget.js`, `pipeline/run_placard_value.js` e `pipeline/test_placard_value.js` apenas na cópia de trabalho; somente `LOG_ATIVIDADES.md` publicado nesta parada.
- Commit: commit desta entrada na `main`; a implementação não foi publicada porque o aceite falhou.
- Resultado do aceite: não passou. Nenhuma chave literal nos arquivos atuais rastreados; 32/32 testes passaram; saldo real de 5.285 créditos e 19 chaves com situação normal no resumo. A execução produziu zero comparações novas e sete falhas do catálogo Placard, uma por esporte, todas com “Nenhum slug Placard respondeu”. Evidências: saída do teste, `placard_run_summary.json` local, resumo `results/placard_current` e log da execução às 06:36–06:37.
- Problemas encontrados: o catálogo do Placard não respondeu na máquina nesta execução; o requisito de comparações novas ficou sem prova.
- Pendências: aceitar e publicar a implementação da Parte 1 após uma execução com comparações novas; Partes 2 a 8 não iniciadas.

## 2026-10-23 — Parte 1: publicação para aceite no GitHub Actions

- Início: 10:07:19 (relógio do Windows).
- Fim da preparação: 10:07:44 (relógio do Windows); o resultado do aceite será acrescentado ao final deste arquivo quando a execução terminar.
- Pedido recebido: publicar a implementação preparada da cota e das 19 chaves, executar o workflow real e prosseguir somente após o aceite.
- O que foi feito: repetidos os testes da rotina e preparada a publicação da implementação da Parte 1, mantendo os segredos fora do repositório.
- Arquivos alterados: `pipeline/odds_api_client.js`, `pipeline/odds_api_monthly_budget.js`, `pipeline/run_placard_value.js`, `pipeline/test_placard_value.js`, `LOG_ATIVIDADES.md`.
- Commit: commit desta publicação na `main` (identificado no histórico; o arquivo não pode conter seu próprio hash).
- Resultado do aceite nesta etapa: 32 de 32 testes passaram; execução do workflow e comparações reais ainda pendentes. Evidência: `node --test pipeline/test_placard_value.js` às 10:07.
- Problemas encontrados: o catálogo Placard não respondeu na execução local anterior.
- Pendências: validar o workflow real; registrar o resultado e os catálogos de icehockey, americanfootball e mma que falham no GitHub.

## 2026-10-23 — Parte 1: resultado do aceite no GitHub Actions

- Início: 10:07:19 (relógio do Windows).
- Fim do aceite: 10:15:04 (relógio do Windows).
- Pedido recebido: validar a Parte 1 no ambiente real e continuar somente se houver leituras e comparações sem erro de teto mensal.
- O que foi feito: executado manualmente o workflow `Placard x Pinnacle` no commit `12e695b` e acompanhado até terminar; confrontados log, artefato de resumo e resultado salvo no Firestore.
- Arquivos alterados: somente `LOG_ATIVIDADES.md` nesta entrada adicional de auditoria.
- Commit: `12e695b` (implementação da Parte 1); commit desta entrada adicional para registrar o resultado posterior à execução.
- Resultado do aceite: passou. Execução `39958739448` concluída com sucesso; 16 consultas à The Odds API, 31 créditos consumidos, 19 jogos e 41 seleções comparadas, sem ocorrência de “Teto mensal de leituras atingido”. Resumo: saldo real 5.254, 19 chaves em situação normal e sincronização completa. Evidências: log e artefato `placard-summary-39958739448` do GitHub Actions; `_placard_control/scan` com `scanRunId=39958739448-1` e `confirmedSelections=41`.
- Problemas encontrados: catálogos Placard de icehockey, americanfootball e mma indisponíveis no GitHub; as competições restantes foram processadas.
- Pendências: tratar esses três catálogos em tarefa própria; Partes 2 a 8 seguem na ordem aprovada.

## 2026-10-23 — Parte 2: cruzamento de nomes de times

- Início: 10:15:29 (relógio do Windows).
- Fim do aceite: 10:20:31 (relógio do Windows); publicação registrada no commit desta parte.
- Pedido recebido: reconhecer variações de nomes, exigir dois times e horário compatível e recruzar os 483 casos salvos.
- O que foi feito: normalizadas letras acentuadas e variantes, removidas siglas de clubes apenas nas extremidades do nome, acrescentados apelidos observados e exigida correspondência inequívoca entre os dois lados do jogo.
- Arquivos alterados: `pipeline/placard_value.js`, `pipeline/placard_aliases.json`, `pipeline/test_placard_value.js`, `LOG_ATIVIDADES.md`.
- Commit: commit desta parte na `main` (identificado pelo histórico Git; o arquivo não pode conter o hash do próprio commit).
- Resultado do aceite: 483/483 rejeições por nome de 58 leituras salvas agora encontram exatamente um jogo da Pinnacle; são 14 confrontos distintos, zero ambiguidades e diferença de horário de 0 s nos 10 exemplos abaixo. Testes: 33/33 passaram. Evidências: `_bookmaker_reads` (as primeiras 58 leituras por `observedAt`), jogos nas subcoleções `games`, odds Pinnacle já salvas em `_placard_reads` e teste `node --test pipeline/test_placard_value.js`.
- Dez exemplos conferidos (local → Pinnacle): Ferencvaros TC/SC União Torreense → Ferencváros TC/Torreense; Besiktas/Crystal Palace → Besiktas JK/Crystal Palace; FC Viktoria Plzen/PFC Levski Sofia → Viktoria Plzeň/PFC Levski Sofia; Jagiellonia Bialystok/Anderlecht → Jagiellonia Białystok/Anderlecht; NK Celje/Salzburgo → NK Celje/Salzburg; Lillestrom SK/Real Sociedad → Lillestrom/Real Sociedad; Hoffenheim/Lyon → TSG Hoffenheim/Lyon; Olympiacos/Sparta Praga → Olympiakos Piraeus/Sparta Prague; SK Sturm Graz/Marselha → SK Sturm Graz/Marseille; GNK Dinamo Zagreb/NEC Nijmegen → Dinamo Zagreb/NEC Nijmegen.
- Problemas encontrados: a implementação anterior não transliterava `ł` e não reconhecia siglas ou as variantes observadas; nenhuma incompatibilidade restante neste conjunto salvo.
- Pendências: nenhuma da Parte 2.

## 2026-10-23 — Parte 3: publicação para aceite da fonte Pinnacle

- Início: 10:21:04 (relógio do Windows).
- Fim da preparação: 10:30:40 (relógio do Windows); o resultado do aceite real será acrescentado ao final após a execução.
- Pedido recebido: usar Arcadia `.se` com chave pública atual e respostas com `Age < 120 s`, mantendo a The Odds API como reserva para comparação e fechamento.
- O que foi feito: adicionada a leitura da chave no `app.json` e sua renovação após HTTP 403, consulta de jogos e mercados a cada 20 s até resposta fresca dentro do prazo, adaptação de resultado/totais/handicaps e registro da fonte em comparações, indicações e fechamentos. A consulta à The Odds API fica como reserva de preços.
- Arquivos alterados: `pipeline/arcadia_pinnacle.js`, `pipeline/run_placard_value.js`, `pipeline/placard_value.js`, `pipeline/test_placard_value.js`, `LOG_ATIVIDADES.md`.
- Commit: commit desta publicação na `main` (identificado no histórico Git; o arquivo não pode conter seu próprio hash).
- Resultado do aceite nesta etapa: 35/35 testes passaram; execução real de `Placard x Pinnacle` ainda pendente. Evidência: `node --test pipeline/test_placard_value.js` às 10:30.
- Problemas encontrados: a Arcadia alterna respostas com e sem `Age`, por isso ambas as respostas necessárias ao preço exigem idade válida abaixo de 120 s.
- Pendências: executar e comprovar uso real da Arcadia, número de consultas frescas e acionamentos da reserva.

## 2026-10-23 — Parte 3: resultado do aceite no GitHub Actions

- Início: 10:21:04 (relógio do Windows).
- Fim do aceite: 10:42:25 (relógio do Windows).
- Pedido recebido: comprovar em uma execução real que `Placard x Pinnacle` usa preços frescos da Arcadia e informar consultas, respostas frescas e usos da reserva.
- O que foi feito: executado manualmente o workflow no commit `696ef30`, acompanhado até o fim e examinados log e artefato de resumo.
- Arquivos alterados: somente `LOG_ATIVIDADES.md` nesta entrada adicional de auditoria.
- Commit: `696ef30` (implementação da Parte 3); commit desta entrada adicional para registrar o resultado posterior à execução.
- Resultado do aceite: não passou. Execução `39961876139` terminou com sucesso operacional, mas registrou 124 consultas à Arcadia, zero respostas frescas, zero pares frescos e 11 usos da reserva (40 créditos The Odds API). O log contém `Arcadia soccer_portugal_primeira_liga: 403`; 32 linhas de erro Arcadia HTTP 403 e 62 releituras de chave no resumo da execução. Evidências: log e artefato `placard-summary-39961876139` do GitHub Actions.
- Problemas encontrados: a API `.se` devolveu HTTP 403 no GitHub Actions mesmo após reler a chave pública; a causa do bloqueio não está comprovada. A rotina recorreu à The Odds API.
- Pendências: obter resposta fresca da Arcadia no ambiente real antes de aceitar a Parte 3; Partes 4 a 8 não iniciadas.

## 2026-10-23 — Passo 1: premissas para desfazer a Parte 3

- Início: 12:42:21 (relógio do Windows).
- Pedido recebido: reverter `696ef30`, manter a The Odds API como única fonte e validar no GitHub Actions.
- Premissas verificadas antes da implementação: `origin/main` está em `9d0310a`; `696ef30` contém a integração Arcadia e uma entrada anterior do log; o workflow `Placard x Pinnacle` aceita disparo manual e executa `pipeline/run_placard_value.js` no GitHub Actions. A entrada anterior do log deve permanecer, apesar da reversão de código.
- O que foi feito: registro prévio das premissas e inclusão da nova regra de auditoria em `AGENTS.md`; reversão e aceite pendentes.
- Arquivos alterados nesta etapa: `AGENTS.md`, `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente da execução real no GitHub Actions.
- Problemas encontrados: nenhum nesta etapa.
- Pendências: reverter código, rodar testes, publicar e validar o workflow.

## 2026-10-23 — Passo 1: reversão preparada

- Início: 12:42:21; fim da preparação: 12:43:05 (relógio do Windows).
- Pedido recebido: retirar a Arcadia e voltar à The Odds API como fonte única da Pinnacle.
- O que foi feito: os três arquivos de código alterados por `696ef30` foram restaurados para o estado anterior; `pipeline/arcadia_pinnacle.js` foi removido; a auditoria histórica foi preservada.
- Arquivos alterados: `AGENTS.md`, `LOG_ATIVIDADES.md`, `pipeline/placard_value.js`, `pipeline/run_placard_value.js`, `pipeline/test_placard_value.js`; removido `pipeline/arcadia_pinnacle.js`.
- Commit: commit desta preparação na `main` (o hash está no histórico Git).
- Resultado do aceite nesta etapa: 33/33 testes locais passaram; o aceite de produção no GitHub Actions ainda está pendente. Evidência: `node --test pipeline/test_placard_value.js` às 12:43.
- Problemas encontrados: nenhum na reversão local.
- Pendências: publicar, executar `Placard x Pinnacle` e verificar zero consultas Arcadia e comparações quando houver jogos.

## 2026-10-23 — Passo 1: aceite no GitHub Actions

- Início: 12:42:21; fim: 12:56:57 (relógio do Windows).
- Pedido recebido: comprovar em produção que a Arcadia saiu e que a comparação usa apenas a The Odds API.
- O que foi feito: publicado `099cffc` na `main`; disparado e acompanhado o workflow `Placard x Pinnacle` até o fim; confrontados log, artefato e `_placard_control/scan` no Firestore.
- Arquivos alterados nesta entrada: somente `LOG_ATIVIDADES.md`.
- Commit: `099cffc` (reversão e regra de auditoria); commit desta entrada adicional (identificado no histórico Git).
- Resultado do aceite: passou. Execução `39980735909` concluída com sucesso no commit `099cffc`, zero linhas Arcadia no log, 4 consultas The Odds API, 5 créditos, 35 diagnósticos, 51 seleções comparadas e 6 confirmadas; `scanRunId=39980735909-1`. Evidências: log e artefato `placard-summary-39980735909` do GitHub Actions; `_placard_control/scan` no Firestore.
- Problemas encontrados: catálogos de icehockey, americanfootball e mma permaneceram indisponíveis; não afetam este aceite.
- Pendências: nenhuma do Passo 1; iniciar a Parte 4.

## 2026-10-23 — Parte 4: premissas antes da implementação

- Início: 12:57:22 (relógio do Windows).
- Pedido recebido: avisos no Telegram para indicações novas e reconferência de Placard ao abrir o app, com aceite no Telegram e no Firebase real.
- Premissas verificadas: o workflow GitHub Actions `Placard x Pinnacle` grava indicações em `_placard_opportunities`; cada leitura salva jogos e odds Placard em `_placard_reads`; o app lê `results/placard_current` e hoje apenas calcula a idade da indicação; as Functions rodam em Firebase e os segredos The Odds API foram configurados na Parte 1. A leitura do Placard pode ter até 30 minutos e deve ter a idade exibida, sem presumir atualização instantânea.
- Dependência ainda não satisfeita: token do robô Telegram e conversa iniciada pelo Alex para identificar o destinatário; pedido enviado ao Alex nesta etapa.
- O que foi feito: somente leitura do código e registro das premissas; implementação pendente.
- Arquivos alterados nesta etapa: `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente de mensagem de teste recebida e chamada ao serviço Firebase publicado.
- Problemas encontrados: nenhum nesta etapa.
- Pendências: implementar, publicar e aceitar no ambiente real antes da Parte 5.

## 2026-10-23 — Parte 4: parada por segredo ausente

- Início: 12:57:22; fim da preparação: 13:11:30 (relógio do Windows).
- Pedido recebido: avisar indicações novas pelo Telegram e reconferir o Placard com a leitura mais recente e a The Odds API no Firebase.
- O que foi feito: preparada na cópia de trabalho a Function de aviso, a Function autenticada de reconferência, a leitura do app e testes; pedido ao Alex o token do robô e a conversa iniciada. Nenhum código desta parte foi publicado ou implantado.
- Arquivos alterados apenas localmente: `functions/index.js`, `functions/placard_part4.js`, `functions/odds_api_monthly_budget.js`, `functions/placard_value.js`, `functions/placard_aliases.json`, `functions/test_placard_part4.js`, `functions/package.json`, `functions/package-lock.json`, `lib/services/api_service.dart`, `lib/screens/placard_opportunities_screen.dart`; esta entrada em `LOG_ATIVIDADES.md` será publicada sozinha.
- Commit: commit desta entrada de auditoria na `main` (identificado no histórico Git); nenhum commit de implementação da Parte 4.
- Resultado do aceite: não executado, pois o token e o identificador da conversa Telegram ainda não foram fornecidos. Testes locais do módulo: 5/5 passaram; 33/33 testes do comparador passaram. O teste Flutter existente falhou ao montar o app porque não inicializa Firebase (`core/no-app`), sem apontar erro de compilação na alteração. Evidências: saídas de `node --test` e `flutter test test/widget_test.dart` nesta sessão.
- Problemas encontrados: segredo e destinatário Telegram pendentes; o teste Flutter existente depende de inicialização Firebase ausente.
- Pendências: receber token, configurar segredos, publicar, implantar e executar os dois aceites reais. Partes 5 a 8 não iniciadas.

## 2026-10-23 — Parte 4: retomada e premissas de publicação

- Início: 13:25:01 (relógio do Windows).
- Pedido recebido: usar o token do robô fornecido pelo Alex e concluir a Parte 4.
- Premissas verificadas antes da publicação: `origin/main` está em `ee5e2d5`; o código preparado permaneceu apenas nesta cópia de trabalho; o token foi recebido nesta sessão e não será gravado no repositório. Ainda é necessário identificar a conversa iniciada com o robô, configurar os dois segredos no Firebase e validar no Telegram e no serviço Firebase em produção.
- O que foi feito: somente leitura do estado e registro prévio destas premissas; publicação pendente.
- Arquivos alterados nesta etapa: `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente.
- Problemas encontrados: nenhum nesta retomada.
- Pendências: configurar, testar, publicar e aceitar.

## 2026-10-23 — Parte 4: preparação para aceite de produção

- Início: 13:25:01; fim da preparação: 13:28:56 (relógio do Windows).
- Pedido recebido: concluir o aviso Telegram e a reconferência com o token fornecido, sem guardar credenciais no repositório.
- O que foi feito: configurados `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` como segredos Firebase; identificada a conversa privada iniciada pelo Alex; enviada mensagem de teste pelo robô, recebida e confirmada pelo Alex. Preparados os gatilhos de indicação e uso externo suspeito, a reconferência autenticada com reserva de créditos e cache de 2 minutos, e a interface do app.
- Arquivos alterados: `functions/index.js`, `functions/placard_part4.js`, `functions/odds_api_monthly_budget.js`, `functions/placard_value.js`, `functions/placard_aliases.json`, `functions/test_placard_part4.js`, `functions/package.json`, `functions/package-lock.json`, `lib/services/api_service.dart`, `lib/screens/placard_opportunities_screen.dart`, `LOG_ATIVIDADES.md`.
- Commit: commit desta implementação na `main` (identificado no histórico Git).
- Resultado do aceite nesta etapa: mensagem de teste `message_id=4` entregue na conversa privada e confirmada pelo Alex; 5/5 testes do módulo passaram; 19 chaves The Odds API presentes em segredo Firebase. Reconferência no serviço Firebase real ainda pendente. Evidências: resposta HTTP do Telegram e confirmação do Alex nesta sessão; saída `node --test functions/test_placard_part4.js`.
- Problemas encontrados: a primeira consulta ao robô não retornou mensagens; após nova mensagem do Alex, `getUpdates` retornou a conversa. Nenhum token foi registrado no projeto.
- Pendências: publicar e implantar as novas Functions; executar reconferência real e registrar o resultado. Partes 5 a 8 aguardam este aceite.

## 2026-10-23 — Parte 4: aceite em produção

- Início: 13:25:01; fim: 13:35:36 (relógio do Windows).
- Pedido recebido: avisar indicações novas no Telegram e reconferir as do Placard em produção, mostrando situação e idade da leitura.
- Premissas verificadas antes da implementação: indicações novas são documentos em `_placard_opportunities`; leituras do Placard estão em `_placard_reads`; a reserva de créditos e as 19 chaves da The Odds API já estavam configuradas; o Alex iniciou a conversa com o robô.
- O que foi feito: publicados o aviso de indicações, o alerta de uso externo suspeito, a reconferência autenticada e a interface correspondente; implantadas as três Functions; criada e depois removida uma indicação de teste no Firestore.
- Arquivos alterados: `functions/index.js`, `functions/odds_api_monthly_budget.js`, `functions/placard_aliases.json`, `functions/placard_part4.js`, `functions/placard_value.js`, `functions/test_placard_part4.js`, `functions/package.json`, `functions/package-lock.json`, `lib/screens/placard_opportunities_screen.dart`, `lib/services/api_service.dart`, `LOG_ATIVIDADES.md`.
- Commit: `381bfa8` na `main`; este complemento de auditoria será publicado em commit próprio.
- Resultado do aceite: passou. O Alex confirmou o recebimento da mensagem de teste `message_id=4`. O gatilho Firebase da indicação de teste registrou `telegramMessageId=5`. A Function `revalidatePlacardOpportunities` respondeu HTTP 200 para Brest x Nice: situação `expirou`, motivo `odd abaixo da mínima`, leitura Placard de 16:15:02 UTC, odd 2,26, mínima atual 2,488956, Pinnacle atualizada às 16:33:29 UTC; resposta às 16:33:59 UTC, logo idade da leitura Placard de aproximadamente 19 minutos. O cache de reconferência foi gravado às 16:33:59 UTC e o consumo de outra leitura foi registrado no orçamento. Evidências: respostas do Telegram e da Function nesta sessão, documentos `_placard_opportunities` e `_placard_revalidation_cache`, e confirmação do Alex; documento de teste apagado e ausência confirmada.
- Problemas encontrados: a primeira implantação pediu confirmação da política de tentativas; a segunda, com `--force` do Firebase CLI, implantou as três Functions. O teste Flutter existente falha por ausência de inicialização Firebase no teste (`core/no-app`), sem falha apontada nas alterações. A versão Web do app ainda não foi compilada nem implantada nesta etapa.
- Pendências: nenhuma para o aceite ajustado da Parte 4; a publicação da interface Web depende de compilação e implantação em tarefa autorizada.

## 2026-10-23 — Parte 5: premissas antes da implementação

- Início: 13:36:07 (relógio do Windows).
- Pedido recebido: registrar a odd realmente apostada e mostrar no relatório o CLV dela ao lado do CLV da indicação; testar com uma aposta real de teste e removê-la.
- Premissas verificadas: o app já grava apostas em `bets` com o campo `odds`, mas a tela Placard ainda não oferece registro ligado à indicação; as indicações e suas odds de fechamento estão em `_placard_opportunities`, com `closingFairOdds` e `clvPct`; o resumo Placard é publicado pelo workflow GitHub Actions em `results/placard_current`; a coleção `bets` é protegida pela regra `isOwner()` no app e pode ser lida pelo pipeline com a conta de serviço.
- O que foi feito nesta etapa: leitura do fluxo e registro prévio das premissas.
- Arquivos alterados nesta etapa: `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente de aposta de teste, relatório de produção com os dois CLVs e exclusão da aposta.
- Problemas encontrados: nenhum nesta etapa.
- Pendências: implementar, testar, publicar, executar o workflow em produção, conferir e remover a aposta de teste.

## 2026-10-23 — Parte 5: implementação preparada

- Início: 13:36:07; fim da preparação: 13:39:35 (relógio do Windows).
- Pedido recebido: capturar a odd efetivamente apostada e mostrar os dois CLVs no relatório.
- Premissas verificadas antes de alterar o código: `bets.odds` já guarda a odd efetiva; `bets.indicationId` pode ligar a aposta à indicação; o mesmo registro de indicação contém seleção, linha e odd justa de fechamento; a base Firestore `(default)` é STANDARD em `southamerica-east1`.
- O que foi feito: acrescentado formulário de aposta na tela Placard com odd e valor; o pipeline associa apostas a indicações por ID e publica no relatório os CLVs pareados, usando a mesma odd justa de fechamento para ambos.
- Arquivos alterados: `lib/screens/placard_opportunities_screen.dart`, `pipeline/placard_value.js`, `pipeline/run_placard_value.js`, `pipeline/test_placard_value.js`, `LOG_ATIVIDADES.md`.
- Commit: commit desta implementação na `main` (identificado no histórico Git).
- Resultado do aceite nesta etapa: pendente da validação em produção. Teste do comparador: 34/34 passaram, inclusive indicação 2,10 e aposta 2,20 contra fechamento 2,00, resultando em 5% e 10%. O smoke test Flutter existente ainda falha em `core/no-app` por não inicializar Firebase no teste, como já registrado na Parte 4; o código da tela compilou.
- Problemas encontrados: teste Flutter legado não prepara Firebase.
- Pendências: publicar, registrar uma aposta de teste pelo endpoint autenticado usado pelo app, executar `Placard x Pinnacle`, conferir os dois CLVs e remover a aposta.

## 2026-10-23 — Parte 5: aceite em produção

- Início: 13:36:07; fim: 13:45:59 (relógio do Windows).
- Pedido recebido: registrar a odd realmente apostada, mostrar o CLV da indicação e o da aposta, testar e apagar a aposta de teste.
- Premissas verificadas antes da implementação: o app usa `bets` e autenticação do proprietário; o fechamento da mesma seleção/linha está na indicação; `Placard x Pinnacle` publica o relatório do app no Firestore.
- O que foi feito: publicado `9e0097a` na `main`; criada aposta de teste pelo endpoint Firestore autenticado que o app usa; executado o workflow real para gerar o relatório; apagada a aposta; executado o workflow novamente para limpar o relatório; compilado e implantado o app Web no Firebase Hosting.
- Arquivos alterados: `lib/screens/placard_opportunities_screen.dart`, `pipeline/placard_value.js`, `pipeline/run_placard_value.js`, `pipeline/test_placard_value.js`, `LOG_ATIVIDADES.md`.
- Commit: `9e0097a` (implementação); este complemento de auditoria será publicado em commit próprio.
- Resultado do aceite: passou. Aposta de teste `part5-test-20261023-1342` criada com HTTP 200, odd indicada 1,92, odd apostada 2,00 e fechamento justo 1,8585539917 para Bournemouth x AC Milan, vencedor Bournemouth. Execução GitHub Actions `39988998573` concluiu com sucesso; `results/placard_current` publicou CLV da indicação 3,306119% e CLV da aposta 7,610541%, ambos para a mesma indicação. A aposta foi apagada e sua ausência confirmada; execução `39989124585` concluiu com sucesso e o relatório publicado deixou de conter a linha de teste (`withClosing=0`). O app Web compilou e o Firebase Hosting foi publicado em `https://odds-app-edge.web.app` com HTTP 200 e as frases novas presentes no JavaScript servido. Evidências: respostas das APIs de autenticação/Firestore/GitHub, `results/placard_current`, saída de `flutter build web` e `firebase deploy --only hosting`.
- Problemas encontrados: o smoke test Flutter legado falhou em `core/no-app` porque não inicializa Firebase; o teste do comparador passou 34/34. A compilação Web terminou com avisos de Wasm de dependência, sem falha.
- Pendências: nenhuma da Parte 5; iniciar a Parte 6.

## 2026-10-23 — Parte 6: premissas antes da implementação

- Início: 13:46:29 (relógio do Windows).
- Pedido recebido: fazer cada casa ler a própria listagem nas dez ligas de futebol e NBA, sem depender da Betano ou da Pinnacle; validar num ciclo real de até 10 minutos.
- Premissas verificadas: a tarefa agendada chama `pipeline/local_betano_reader.js`, que encaminha para `pipeline/local_bookmaker_cycle_fast.cjs`; este inicia a Betano primeiro e passa seus jogos às demais casas, exige sucesso da Betano e executa as leituras em paralelo por 60 segundos. Os leitores rápidos têm feeds/HTML próprios, mas usam times, horários e liga da Betano para casar eventos. A cópia principal do projeto está 17 commits atrás e contém uma alteração local não publicada em `pipeline/local_bookmaker_cycle_fast.cjs`; esta cópia de trabalho isolada está limpa e em `main` publicado. A base Firestore `(default)` é STANDARD e recebe `_bookmaker_reads` para o comparador da nuvem.
- O que foi feito nesta etapa: somente leitura e registro prévio das premissas; nenhuma conexão VPN.
- Arquivos alterados nesta etapa: `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente de um ciclo real com tempos, ligas e jogos por casa.
- Problemas encontrados: leitores rápidos atuais dependem dos jogos Betano e vários feeds só selecionam a Liga Europa.
- Pendências: implementar coleta independente e verificar um ciclo real, sem alterar o agendamento.

## 2026-10-23 — Parte 6: implementação e aceite nesta máquina

- Início: 13:46:29; fim da validação: 14:06:50 (relógio do Windows).
- Pedido recebido: eliminar a lista Betano/Pinnacle como referência local, ler listagens próprias com prioridade de competições e validar em ciclo real sem ultrapassar 10 minutos.
- Premissas registradas antes da implementação: o ciclo antigo dependia da Betano; cada casa já tinha feed ou página própria, mas reaproveitava times, horário e liga da Betano; o comparador na nuvem recebe `_bookmaker_reads` com esses campos.
- O que foi feito: descartada apenas a alteração local não publicada que pausava a coleta por referência Pinnacle; criado mapeamento de competições e horários locais; leitores rápidos passaram a obter eventos e odds da própria casa, com DNS público nas requisições diretas e fallback de navegador; seis casas são tentadas independentemente, com limite de 120 s por casa, ordenação por competição e sucesso do ciclo com ao menos uma leitura; o log completo passou a contar jogos por liga e por casa.
- Arquivos alterados: `pipeline/local_bookmaker_cycle_fast.cjs`, `scripts/local_bookmakers/fast_readers.cjs`, novos `scripts/local_bookmakers/local_competitions.cjs` e `scripts/local_bookmakers/test_independent_readers.cjs`, `LOG_ATIVIDADES.md`. Na cópia principal, a modificação não publicada de `pipeline/local_bookmaker_cycle_fast.cjs` foi descartada; os demais arquivos locais não foram tocados.
- Commit: commit desta implementação na `main` (identificado no histórico Git).
- Resultado do aceite: passou pelo critério de um ciclo real e pelo critério de sucesso com ao menos uma casa. Primeiro ciclo: 131.286 ms; depois da correção de DNS, segundo ciclo: 130.787 ms, VPN 89.476 ms, desconectado ao fim. Bwin leu 6 jogos (Primeira Liga, Premier League, La Liga, Serie A, Bundesliga e Ligue 1: 1 cada), enviou `_bookmaker_reads/local-bwin-1792774646787-434` no primeiro ciclo e obteve 22 seleções processadas; no segundo ciclo obteve novamente 6 jogos e 22 seleções. Betano, LeBull, ESC Online, GoldenPark e Retabet: 0 jogos, com falhas individuais registradas. Testes locais: 3/3 do novo leitor e 34/34 do comparador. Evidências: `.local_logs/betano/cycle-2026-10-23T16-55-53-336Z.json`, `cycle-2026-10-23T16-59-34-924Z.json`, respectivos `hourly-cycles.jsonl` e `_bookmaker_reads` no Firestore.
- Problemas encontrados: a primeira versão do lookup DNS não atendia a opção `all` do Node 24 e foi corrigida antes do segundo ciclo. No segundo, a Bwin respondeu HTTP 403 à requisição direta, mas o feed carregado pelo Edge funcionou; Betano ficou sem odds elegíveis; LeBull sem iframe; ESC Online sem mercado/horário utilizável; GoldenPark esgotou a espera; Retabet retornou páginas sem liga/horário/mercados completos. Medição de 41,462 MB no segundo ciclo é limite superior do Wi-Fi, não atribuição por casa; a Parte 7 mudará a medição do orçamento para a placa VPN.
- Pendências: instalar os arquivos publicados no caminho da tarefa agendada e confirmar sintaxe; seguir para a Parte 7. As cinco casas com leitura falha permanecem com o motivo no log e podem ser tentadas novamente nos próximos ciclos.

## 2026-10-23 — Parte 6: instalação na tarefa local

- Início: 14:06:50; fim: 14:08:22 (relógio do Windows).
- Pedido recebido: deixar a coleta independente publicada e utilizável pela tarefa local existente, sem alterar o agendamento.
- Premissas verificadas: a tarefa `EdgeFinder-Betano-Local` usa a cópia principal do projeto; ela estava `Ready`; os três arquivos de execução alvo estavam limpos antes da instalação; `local_betano_reader.js` e `daily_summary.cjs` eram iguais nas duas cópias.
- O que foi feito: copiados apenas `pipeline/local_bookmaker_cycle_fast.cjs`, `scripts/local_bookmakers/fast_readers.cjs` e o novo `scripts/local_bookmakers/local_competitions.cjs` para a cópia principal usada pela tarefa. O agendamento e os demais arquivos locais não foram alterados.
- Arquivos alterados nesta instalação: os três arquivos citados na cópia principal e este `LOG_ATIVIDADES.md` na cópia de publicação.
- Commit: `1c6b419` já publicado na `main`; este complemento de auditoria será publicado em commit próprio.
- Resultado do aceite: os três arquivos instalados passaram `node --check`; o módulo dos leitores carregou na cópia principal. O ciclo real anterior, executado nesta máquina com os mesmos arquivos, terminou em 130.787 ms e leu 6 jogos da Bwin, com 22 seleções comparadas. Evidências: log do ciclo, saídas de sintaxe e carga do módulo, estado da tarefa `Ready`.
- Problemas encontrados: a cópia principal da branch `main` está atrasada e tem alterações não relacionadas de outra sessão; por isso somente os arquivos da coleta foram instalados, ficando modificados localmente até uma atualização geral da cópia principal. Essa atualização não faz parte deste pedido.
- Pendências: nenhuma do aceite da Parte 6; iniciar a Parte 7. As falhas das cinco casas constam no log do ciclo.

## 2026-10-23 — Parte 7: premissas antes da implementação

- Início: 14:08:48 (relógio do Windows).
- Pedido recebido: controlar os 2.700 MB até 31/10 pelos bytes da placa VPN somados por ciclo e pausar a partir de 01/11.
- Premissas verificadas: o ciclo atual lê uma vez o saldo do TunnelBear antes da conexão e usa a diferença desde `initialBalanceMB=10219` para bloquear; o adaptador se chama `Ethernet 2`, descrição `TunnelBear Adapter V9`, e `Get-NetAdapterStatistics` não retornou dados quando estava desconectado. Nos dois ciclos reais da Parte 6, a fonte da medição caiu para limite superior do Wi-Fi, pois `vpnNetworkBytes()` retornou nulo. O orçamento antigo permanece em `.local_logs/betano/vpn-budget.json`; a rotina já pausa depois de 31/10.
- O que foi feito nesta etapa: só leitura do estado e registro prévio das premissas; nenhuma alteração de código ou conexão VPN.
- Arquivos alterados nesta etapa: `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente de ciclo real cujo log registre bytes do adaptador VPN.
- Problemas encontrados: contador NDIS do adaptador virtual indisponível enquanto desconectado; é necessário confirmar uma fonte de bytes do mesmo adaptador durante a conexão.
- Pendências: identificar contador da placa VPN, implementar orçamento e aceitar num ciclo real.

## 2026-10-23 — Parte 7: resultado do aceite

- Início: 14:08:48; fim: 14:18:11 (relógio do Windows).
- Pedido recebido: medir o orçamento de 2.700 MB pelos bytes do adaptador VPN, somados por ciclo, até 31/10; pausar a partir de 01/11.
- O que foi feito: a leitura da placa passou a usar `NetworkInterface.GetIPv4Statistics()` para `TunnelBear Adapter V9`; cada ciclo grava a diferença dos contadores e a acumula em `vpn-budget.json`. O histórico anterior foi migrado uma única vez a partir do último consumo já registrado, sem nova leitura da janela TunnelBear. Falha de contador bloqueia os próximos ciclos.
- Arquivos alterados: `pipeline/local_betano_reader.js`, `pipeline/local_bookmaker_cycle_fast.cjs`, `LOG_ATIVIDADES.md`; instalação dos dois arquivos de código e do orçamento no diretório usado pela tarefa local.
- Commit: `339ab8e` (implementação); este registro será publicado no commit de auditoria subsequente.
- Resultado do aceite: ciclo real `cycle-2026-10-23T17-15-02-754Z.json` completo em 128.201 ms, VPN 79.681 ms, adaptador 34.440.652 bytes (34,440652 MB), acumulado 184,440652 MB = 150 MB migrados + 34,440652 MB medidos. `hourly-cycles.jsonl` contém `vpnAdapterBytes=34440652`; adaptador desconectado ao final. Testes Node: 34/34 e leitores independentes 3/3.
- Problemas encontrados: `Get-NetAdapterStatistics` não expõe estatísticas desse adaptador nem quando conectado; a API .NET do Windows expõe os contadores. Os 150 MB migrados foram medidos pelo controle anterior, porque os ciclos anteriores não tinham bytes do adaptador.
- Pendências: nenhuma do aceite da Parte 7; iniciar a Parte 8.

## 2026-10-23 — Parte 8: premissas antes da implementação

- Início: 14:18:11 (relógio do Windows).
- Pedido recebido: retirar Casino Portugal da coleta, incluir Betclic na coleta independente e registrar HTTP 403 sem interromper as demais casas; confirmar casas ativas no resumo diário.
- Premissas verificadas: o ciclo agendado `local_bookmaker_cycle_fast.cjs` executa seis casas em paralelo e já não executa Casino Portugal; o único alvo remanescente dessa casa está no diagnóstico opcional `scheduled_feed_probe.cjs`. Betclic ainda não está na lista ativa; `betclic_reader.cjs` lê apenas Liga Europa e depende de lista externa de jogos, portanto não atende à coleta independente da Parte 6. O resumo diário usa lista estática `NAMES` e pode listar casas ativas mesmo com falha de leitura.
- O que foi feito nesta etapa: somente leitura do código e registro das premissas.
- Arquivos alterados nesta etapa: `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente de resumo diário com Betclic ativa e Casino Portugal ausente.
- Problemas encontrados: a Betclic pode responder HTTP 403; essa condição deve ser registrada por ciclo sem impedir as demais casas.
- Pendências: implementar, testar e aceitar no ciclo local real.

## 2026-10-23 — Parte 8: resultado do aceite

- Início: 14:18:11; fim: 14:25:02 (relógio do Windows).
- Pedido recebido: ativar Betclic na coleta independente, retirar Casino Portugal e confirmar a lista no resumo diário.
- O que foi feito: Betclic lê listagens e mercados de seu próprio site, integra o ciclo em paralelo e envia jogos ao Firestore; HTTP 403 é registrado como falha da Betclic sem interromper outras casas. O alvo opcional Casino Portugal foi removido. Código, orçamento e quatro logs de ciclos manuais foram instalados/mesclados no diretório da tarefa agendada; resumo diário foi regravado.
- Arquivos alterados: `pipeline/local_bookmaker_cycle_fast.cjs`, `scripts/local_bookmakers/fast_readers.cjs`, `scripts/local_bookmakers/daily_summary.cjs`, `scripts/local_bookmakers/scheduled_feed_probe.cjs`, `LOG_ATIVIDADES.md`; logs locais e `vpn-budget.json` no diretório da tarefa.
- Commit: `7a5a504` (implementação); este registro será publicado no commit de auditoria subsequente.
- Resultado do aceite: ciclo real `cycle-2026-10-23T17-21-08-617Z.json` completo em 137.118 ms, VPN 83.046 ms, Betclic leu cinco jogos próprios em cinco ligas, 45 seleções, leitura `local-betclic-1792776159988-921` enviada ao Firestore; Bwin leu seis jogos. O resumo local `resumo-2026-10-23.txt` lista Betclic com um sucesso e não lista Casino Portugal. Testes Node: 37/37.
- Problemas encontrados: a comparação na nuvem devolveu `processed_with_errors` e zero seleções cruzadas para Betclic, com a mensagem `Futebol bloqueado até validar 20 seleções contra Pinnacle.` O bloqueio de validação não foi alterado porque não faz parte do aceite desta parte.
- Pendências: validar Betclic na nuvem antes de contar comparações ou indicações; nenhuma pendência no aceite solicitado para a Parte 8.

## 2026-10-23 — Diagnóstico das cinco casas: premissas

- Início: 14:28:36 (relógio do Windows).
- Pedido recebido: identificar sem alterar a coleta as causas de falha de Betano, LeBull, ESC Online, Retabet e GoldenPark; capturar HTML e telas com uma conexão VPN e medir seus bytes; comparar GoldenPark e Retabet com 22/10 às 14:39.
- Premissas verificadas antes do diagnóstico: a tarefa `EdgeFinder-Betano-Local` está pronta, o adaptador TunnelBear desconectado e o ciclo de 22/10 às 14:39 registrou sucesso para Betano, Bwin, GoldenPark e Retabet, LeBull vazia e ESC Online em timeout. O commit `1c6b419` alterou os leitores de listagem própria depois daquele ciclo; o commit `339ab8e` trocou apenas a fonte do contador da VPN.
- O que foi feito nesta etapa: leitura do estado e do histórico e registro prévio; nenhuma conexão VPN ainda.
- Arquivos alterados: `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente das capturas e da comparação.
- Problemas encontrados: nenhum nesta etapa.
- Pendências: executar o diagnóstico e publicar este registro com o resultado.

## 2026-10-23 — Diagnóstico das cinco casas: resultado

- Início: 14:28:36; fim das leituras e análise: 14:40:18 (relógio do Windows).
- Pedido recebido: investigar as cinco falhas com uma conexão VPN e comparar GoldenPark e Retabet com o ciclo de 22/10 às 14:39, sem modificar a coleta.
- O que foi feito: uma conexão VPN; páginas abertas no Edge persistente, com HTML e capturas guardados em `.local_logs/betano/diagnostico-2026-10-23/`; resposta completa da API Betano guardada separadamente em arquivos `*-headers.json` e `*-body.bin`; adaptador VPN lido antes e depois; VPN desconectada. Comparados o ciclo de 22/10 e os leitores antes/depois do commit `1c6b419`.
- Arquivos alterados: somente `LOG_ATIVIDADES.md` no repositório; artefatos ignorados na pasta local de diagnóstico.
- Commit: registro a publicar na `main` (hash identificável no histórico Git).
- Resultado: 53.136.384 bytes (53,136384 MB) no adaptador TunnelBear durante o diagnóstico, conforme `vpn-inicio.json` e `vpn-fim.json`.
- Betano: o acesso sem barra final à API devolveu HTTP 403, `server: cloudflare`, corpo `Betano Splash Screen` com desafio `/cdn-cgi/challenge-platform`; a página normal de futebol respondeu 200. A navegação Edge à API recebeu 301 para a URL com barra final e depois 200. Evidências: `betano-edge-request-*`, `betano-feed-direto-*`, `betano-futebol.*`, `betano-api-403.*` e `betano_lebull-resultado.json`.
- LeBull: o quadro `https://lebullpt-ssr.boxwebcdn.work/pt?currency=EUR&parent=www.lebull.pt&` foi pedido e respondeu HTTP 200, mas não estava entre os frames logo após o carregamento da página; após 44,6 s havia quadro e jogos. A resposta HTML direta contém apenas seis linhas skeleton, sem times/odds, antes da hidratação. O leitor atual tenta esse HTML e verifica o frame imediatamente, explicando a falha observada. Evidências: `lebull-inicial.*`, `lebull-quadro-direto.*`, `lebull-espera-45s.*`, `lebull-espera-quadro.html` e os JSONs de rede.
- ESC Online: a página de jogo respondeu 200 e contém `Total de Golos` com 10 seleções, liga `Liga Portugal` e `Hoje - 16:45`; a extração de texto concatena `MarítimoHoje`, e `localClock()` exige fronteira de palavra antes de `Hoje`, retornando nulo. O leitor descarta o jogo antes de ler o mercado. Evidências: `esc-jogo.*`, `esc_retab-resultado.json`, `fast_readers.cjs:264-289`, `local_competitions.cjs:31-51`.
- Retabet: a página de GD Chaves–FC Vizela respondeu 200, com `Portugal Liga 2`, `Hoje 18:45`, `1-X-2` e `Mais/menos golos`; o leitor olha apenas os primeiros 1.200 caracteres do texto bruto, dominados por script, e o horário aparece após a posição 5.225, portanto não o encontra. Dos primeiros 12 links lidos, só o sétimo era de liga configurada (Eredivisie), e essa página não completou em 45 s; o HTML parcial foi salvo, sem captura devido ao timeout. Evidências: `retabet-jogo.*`, `retabet-eredivisie.html`, `retabet-lista.*`, `fast_readers.cjs:203-263`.
- GoldenPark: após HTTP 200 e 45,005 s, `.line-container.new` não apareceu; a tela mostrava apenas o mercado de campeão da Liga Europa 2026/27, sem partidas. O ciclo anterior registrou `GoldenPark direto sem eventos listados` e timeout no mesmo seletor. Ontem às 14:39 havia 4 jogos e 36 seleções. A razão de a casa não listar partidas nessa página hoje não está demonstrada. Evidências: `goldenpark-lista.*`, `goldenpark-resultado.json`, ciclos `2026-10-22T17-39-35-609Z` e `2026-10-23T17-21-08-617Z`.
- Mudança desde ontem: `1c6b419` (23/10, 14:07) retirou a lista Betano usada para selecionar os jogos de Retabet e GoldenPark. Retabet passou a tomar os primeiros 12 links genéricos e a deduzir liga/horário da página; GoldenPark passou a procurar sua própria listagem, mantendo a página fixa da Liga Europa como fallback. Isso explica a regressão comprovada da seleção/horário na Retabet; na GoldenPark a ausência de partidas observada hoje impede atribuir a falha só à mudança de código.
- Problemas encontrados: a captura de tela da página Eredivisie da Retabet falhou depois do timeout de 45 s; o HTML parcial foi guardado. Nenhum código de coleta foi alterado.
- Pendências: somente publicação deste registro; correções dos leitores não foram solicitadas.

## 2026-10-23 — Correção das cinco casas: premissas antes da implementação

- Início: 14:42:20 (relógio do Windows).
- Pedido recebido: corrigir Betano, LeBull, ESC Online, Retabet e GoldenPark, manter ciclo em até 10 minutos e isolamento de falhas, testar e validar com ciclo real nesta máquina.
- Premissas verificadas: a API Betano sem barra final devolveu 403 e desafio Cloudflare; a navegação Edge à URL com barra final devolveu 200. O iframe LeBull respondeu 200, mas só ficou visível após 44,6 s; o leitor verifica cedo. ESC Online contém `MarítimoHoje - 16:45`, que falha pela fronteira de palavra exigida em `localClock`. Retabet contém horário após a posição 5.225 do texto bruto e o leitor usa só os primeiros 1.200 caracteres; entre os 12 primeiros links, apenas um era de liga configurada. GoldenPark exibiu apenas campeão da Liga Europa e nenhuma linha de jogo em 45 s; a hipótese de não haver partidas dessa liga fora das quintas não foi comprovada. Evidências em `.local_logs/betano/diagnostico-2026-10-23/` e entrada de diagnóstico anterior.
- Estado antes da alteração: `EdgeFinder-Betano-Local` pronta, VPN desconectada; código em `8353885`.
- O que foi feito nesta etapa: somente registro das premissas.
- Arquivos alterados nesta etapa: `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente de testes e ciclo real no Windows.
- Problemas encontrados: hipótese GoldenPark ainda sem confirmação; o código deve avançar para ligas seguintes quando uma estiver vazia.
- Pendências: implementar as cinco correções, testar, executar o ciclo e publicar com o resultado.

## 2026-10-23 — Correção das cinco casas: ajuste após o ciclo das 14:50

- Início: 14:42:20; verificação intermediária: 14:53 (relógio do Windows).
- Pedido recebido: corrigir os cinco leitores e validar no ciclo real da máquina.
- Premissas: as da entrada anterior; o catálogo GoldenPark pode listar só uma liga mesmo quando a página de competição contém links para outras; o HTML ESC pode colar texto também depois do horário.
- O que foi feito: a primeira versão corrigiu barra da API Betano, espera LeBull, hora ESC, filtro e busca completa Retabet, e avanço GoldenPark; 38 testes passaram. Publicação inicial: `75f2514`. O ciclo agendado das 14:50 terminou em 117.362 ms, consumiu 34,153006 MB pela placa VPN e registrou causas por casa, mas as cinco casas não leram. A evidência mostrou que a API Betano ainda retornou 403 pelo cliente direto; a página de competição GoldenPark continha links de outras ligas que o catálogo não forneceu; e no HTML ESC a hora também estava colada ao nome seguinte. Ajuste: Betano consulta a API com barra pelo Edge; GoldenPark extrai ligas também da página da competição; ESC aceita texto colado após a hora; Retabet dá até 20 s à requisição da página de jogo.
- Arquivos alterados: `scripts/local_bookmakers/fast_readers.cjs`, `scripts/local_bookmakers/local_competitions.cjs`, `scripts/local_bookmakers/test_independent_readers.cjs`, `LOG_ATIVIDADES.md`.
- Commit: pendente nesta etapa.
- Resultado do aceite: primeira tentativa não conclusiva para os cinco leitores; repetição pendente. Evidências: `.local_logs/betano/cycle-2026-10-23T17-50-01-966Z.json`, `hourly-cycles.jsonl` e HTML do diagnóstico das 14:41. Os 38 testes passaram novamente após o ajuste.
- Problemas encontrados: 403 direto Betano; catálogo GoldenPark incompleto; fronteira depois da hora ESC; timeout Retabet; LeBull hidratou sem jogos elegíveis.
- Pendências: repetir um ciclo real com a versão ajustada e registrar resultado final.

## 2026-10-23 — Correção das cinco casas: aceite nesta máquina

- Início: 14:42:20; fim da implementação e do aceite: 15:01:53 (relógio do Windows).
- Pedido recebido: corrigir cinco leitores com base no diagnóstico das 14:41, testar, executar ciclo real e publicar.
- Premissas: as da primeira entrada desta tarefa; os links de Primeira Liga, Premier League, La Liga, Serie A, Bundesliga e Ligue 1 da GoldenPark constam no HTML guardado no diagnóstico.
- O que foi feito: a Betano consulta os feeds com barra pelo Edge quando o acesso direto é bloqueado; a LeBull espera o quadro; o relógio da ESC aceita `Hoje` ou `Amanhã` colado aos dois lados; a Retabet procura a hora na página inteira e filtra liga antes de abrir; a GoldenPark continua pelas ligas conhecidas quando uma não tem jogos. O ciclo mantém leituras independentes e limite de 10 minutos.
- Arquivos alterados: `scripts/local_bookmakers/fast_readers.cjs`, `scripts/local_bookmakers/local_competitions.cjs`, `scripts/local_bookmakers/test_independent_readers.cjs` e `LOG_ATIVIDADES.md`.
- Commit: `75f2514`, `c7b024f` e o commit de consolidação que inclui esta entrada.
- Resultado do aceite: 38/38 testes passaram; ciclo real iniciado às 14:58:53, completo em 156.717 ms (2 min 36,717 s), VPN desligado ao final e 44.985.965 bytes (44,985965 MB) consumidos no adaptador. Betano: 0 jogo elegível, embora o Edge tenha recebido HTTP 200 com 18 eventos de futebol e 12 de basquete; LeBull: 0, quadro carregado sem jogo elegível; ESC Online: 4 jogos; Retabet: 4; GoldenPark: 0, sete ligas consultadas com HTTP 200 e sem partidas na janela. Bwin: 6; Betclic: 5. Evidências: `.local_logs/betano/cycle-2026-10-23T17-58-53-226Z.json`, `hourly-cycles.jsonl` e HTML do diagnóstico.
- Problemas encontrados: o cliente HTTP direto da Betano ainda recebe 403; a janela atual não oferece evento Betano elegível, nem partida GoldenPark nas sete ligas acessíveis. Nenhum desses motivos impediu as outras leituras.
- Pendências: não sei se Betano e GoldenPark terão jogos elegíveis em ciclos futuros; nenhuma alteração adicional foi feita para presumir isso.

## 2026-10-23 — Auditoria dos jogos ausentes no ciclo das 14:58

- Início: 15:08:00; fim da investigação: 15:13:17 (relógio do Windows).
- Pedido recebido: verificar, sem mudar a coleta, os jogos da Pinnacle nas 12 horas após o ciclo das 14:58 e os descartes de Betano, LeBull e GoldenPark; tentar uma única conexão VPN se os registros não bastarem.
- Premissas: ciclo iniciado às 14:58:53; janela até 02:58:53 de 24/10, hora de Brasília; o cache `_placard_pinnacle_latest` foi atualizado antes do ciclo. Logs do ciclo não contêm HTML, JSON completo de eventos, nem motivo individual dos descartes.
- O que foi feito: lidos somente o cache já salvo no Firestore, o código, o ciclo JSON e os HTMLs do diagnóstico anterior. Não houve consulta à The Odds API nem alteração na coleta. Houve uma tentativa de conexão VPN, que terminou em `Disconnected` sem abrir páginas; nenhuma segunda tentativa foi feita.
- Arquivos alterados: somente `LOG_ATIVIDADES.md`.
- Commit: `e343ce1` (código examinado); esta entrada é publicada no commit de auditoria correspondente.
- Resultado e evidências: o cache da Pinnacle tinha 0 jogos em Liga Europa e Champions, 1 em cada Primeira Liga, Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie e Championship, e 12 na NBA (20 no total). Fontes: `_placard_pinnacle_latest/{apiSport}`; futebol atualizado entre 17:46 e 17:47 UTC, NBA às 17:15 UTC. Betano consultou `/api/sports/FOOT/hot/trending/leagues/433g/events/` (18 eventos, Liga Europa) e `/api/sports/BASK/hot/trending/leagues/441g/events/` (12 eventos), ambos HTTP 200 pelo Edge, mas o ciclo guardou apenas contagens: não sei o horário e motivo individual de descarte dos 30 eventos. O HTML Betano das 14:31 mostra ao menos um jogo de Liga Europa em 05/11, fora da janela. LeBull consultou `https://www.lebull.pt/apostas-desportivas` e `https://lebullpt-ssr.boxwebcdn.work/pt`; o HTML das 14:35 tinha 51 linhas, incluindo 12 NBA na janela, mas o leitor descarta basquete pela condição `apiSport.startsWith('soccer_')`. Havia dois jogos ao vivo de Bundesliga 2, rejeitados por horário; os demais eram de ligas não configuradas ou fora da janela. A contagem exata do HTML das 14:58 não foi salva. GoldenPark consultou `/competicao/6675-liga-europa`, `/154-primeira-liga`, `/94-premier-league`, `/306-laliga`, `/305-serie-a`, `/268-bundesliga` e `/96-ligue-1-mcdonald-s-r`, todos HTTP 200, mas o log registra zero linhas elegíveis sem guardar a contagem bruta ou motivos por jogo. O HTML das 14:33 confirma só a Liga Europa sem jogos, com mercado de campeão. Fontes: `.local_logs/betano/cycle-2026-10-23T17-58-53-226Z.json` e `.local_logs/betano/diagnostico-2026-10-23/`.
- Problemas encontrados: o TunnelBear não atingiu `Connection secured` na única tentativa, observado `Disconnected`; o log do ciclo mistura página sem jogos com jogo rejeitado pelo filtro, impedindo confirmar a explicação para todas as ligas da GoldenPark. O cache da Pinnacle derruba a afirmação geral de que não havia jogos nas ligas configuradas.
- Pendências: não sei a distribuição dos 30 eventos Betano por horário e liga, o HTML LeBull exatamente às 14:58, nem o número bruto de partidas em cada uma das sete páginas GoldenPark às 14:58.

## 2026-10-23 — Cobertura de ligas, descarte por jogo e confirmação da VPN: premissas

- Início: 15:16:27 (relógio do Windows).
- Pedido recebido: cobrir NBA e dez ligas de futebol em sete casas, auditar cada jogo visto/descartado, confirmar VPN por adaptador ativo e IP português, testar e validar num ciclo real de até 10 minutos.
- Premissas solicitadas antes da implementação: cada casa oferece essas ligas; a placa de rede TunnelBear é identificável no Windows. A primeira ainda não está comprovada para todas as casas e ligas; a segunda é consistente com o adaptador `TunnelBear Adapter V9` usado na medição anterior, mas será verificada na implementação.
- Estado: tarefa agendada `EdgeFinder-Betano-Local` pronta; HEAD `41b73db`. Não foi alterado código nesta etapa.
- Arquivos alterados: `LOG_ATIVIDADES.md`.
- Commit: pendente.
- Resultado do aceite: pendente.
- Problemas encontrados: a última tentativa de VPN às 15:10 não confirmou conexão; precisa de aceite real nesta máquina.
- Pendências: implementar, testar, executar ciclo, registrar resultados e publicar ou reverter se falhar.

## 2026-10-23 — Cobertura de ligas, descarte por jogo e confirmação da VPN: aceite reprovado

- Início: 15:16:27; fim da validação: 15:39:35 (relógio do Windows).
- Pedido recebido: cobrir as 11 ligas nas sete casas, registrar requisição e decisão por jogo, confirmar VPN por adaptador ativo e IP de Portugal; testar e aceitar em ciclo real de até 10 minutos.
- Premissas: as duas premissas pedidas estão na entrada imediatamente anterior, registrada antes da implementação. A oferta efetiva das 11 ligas por cada casa não foi confirmada.
- O que foi feito: alterados temporariamente os leitores, a prioridade, o log do ciclo e a confirmação da VPN; executados 40 testes (40 passaram) e dois ciclos reais. O aceite falhou e o código foi revertido antes da publicação; o checkout do agendador foi restaurado.
- Arquivos alterados e revertidos: `pipeline/local_bookmaker_cycle_fast.cjs`, `scripts/local_bookmakers/fast_readers.cjs`, `scripts/local_bookmakers/goldenpark_reader.cjs`, `scripts/local_bookmakers/local_competitions.cjs`, `scripts/local_bookmakers/test_independent_readers.cjs`, `scripts/local_bookmakers/tunnelbear.ps1`. Registro preservado neste `LOG_ATIVIDADES.md`.
- Commits: tentativa `707308d`; reversão `85c0fef`; esta entrada no commit de auditoria seguinte.
- Resultado do aceite: reprovado. Ciclos de 179,414 s e 181,707 s; VPN confirmado com adaptador `Up` e país `PT`, desligado ao fim; 44,322232 MB e 45,980701 MB pela placa. No segundo ciclo, cache Pinnacle: 12 NBA e 6 futebol na janela; requisições por liga: Betano 11/11, Bwin 11/11, LeBull 11/11, ESC Online 1/11, GoldenPark 8/11, Retabet 1/11 e Betclic 0/11. Jogos da Pinnacle encontrados com times e horário até 10 min: Betano 1 (Primeira), Bwin 3 (Primeira, Premier, La Liga), LeBull 11 (NBA), ESC 2 (Premier, La Liga), GoldenPark 14 (12 NBA, Premier, La Liga), Retabet 1 (La Liga), Betclic 0. A tolerância estrita de 1 min do comparador não cruzou os 11 NBA da LeBull nem os 12 da GoldenPark.
- Evidências: `.local_logs/betano/cycle-2026-10-23T18-31-28-963Z.json`, `.local_logs/betano/cycle-2026-10-23T18-36-32-913Z.json`, `tunnelbear_attempts_2026-10.jsonl`, resultado de `node --test scripts/local_bookmakers/test_independent_readers.cjs pipeline/test_placard_value.js` nesta sessão.
- Problemas encontrados: Betclic terminou com timeout de 20 s antes de registrar jogos; ESC Online e Retabet tiveram HTTP 403 na NBA e não auditaram futebol; GoldenPark não encontrou três ligas no catálogo observado; Bwin NBA respondeu 403; Betano NBA listou 12 jogos sem mercados no payload. Logo, a exigência de cobertura e a auditoria da casa com 0% não passaram.
- Pendências: identificar rotas/feeds das ligas não cobertas e a causa do timeout da Betclic antes de nova implementação; nenhum código reprovado permanece na `main` após a reversão.

## 2026-10-23 — Reaplicação seletiva da cobertura local: premissas

- Início: 16:01:08 (Get-Date, Windows).
- Pedido recebido: medir linha de base, reaplicar `707308d`, corrigir Betclic/ESC Online/Retabet, medir com a mesma lista Pinnacle, decidir cada casa pela tabela dada e publicar somente o resultado aprovado.
- Premissas antes da implementação: `main` em `2f8c132`; a tarefa agendada usa o checkout `C:\Users\Alex Salles\Apps - desenvolvimento\odds_app`; o worktree de validação aponta `.local_logs/betano` por junction para a pasta de logs da produção; o junction não muda o executável nem o código da tarefa, mas os ciclos manuais no worktree escrevem no mesmo log e orçamento. O orçamento registra 150 MB trazidos e 305,38 MB medidos de 2.700 MB até 31/10. A tarefa está pronta, não executando.
- Critério de medição: cache Pinnacle congelado no ciclo da linha de base; jogo único com os dois times reconhecidos e horário até 10 min; rejeitar odds com margem fora de 0% a 25% ou mais de 30% acima do preço justo. Se o cache tiver menos de cinco jogos em 12 h, usar 24 h. Registrar odds implausíveis no log.
- Arquivos alterados nesta etapa: `LOG_ATIVIDADES.md`.
- Commit: pendente; resultado do aceite: pendente.

## 2026-10-23 — Reaplicação seletiva: linha de base

- Início da etapa: 16:02:45; fim: 16:05:10 (relógio do Windows).
- Pedido recebido: medir um ciclo real do código atual da `main` contra a lista da Pinnacle congelada no começo.
- O que foi feito: congelado o cache da nuvem às 16:02:45, com 12 jogos NBA e 1 da Primeira Liga nas 12 horas seguintes; ciclo real iniciado às 16:02:57, encerrado em 115,206 s, com VPN desligado ao final e 30,365439 MB medidos no adaptador. A primeira invocação de `main()` falhou em 0,392 s antes de ligar o VPN porque o worktree não carregava `.env`; a invocação correta usou o `.env` local da pasta agendada.
- Medida de cobertura por casa: Betano 0, Bwin 1 (Primeira Liga), LeBull 0, ESC Online 0, GoldenPark 0, Retabet 0, Betclic 0. Nenhuma odd implausível encontrada entre as seleções cruzadas; Retabet e Betclic enviaram um jogo cada, mas não tiveram odd comparável válida pela medida.
- Arquivos alterados: snapshot e log de cobertura em `.local_logs/betano` (ignorados pelo Git); `LOG_ATIVIDADES.md`. Commit: pendente.
- Evidências: `.local_logs/betano/coverage-pinnacle-snapshot-20261023.json`, `coverage-baseline.json`, `cycle-2026-10-23T19-02-57-539Z.json`.
- Problemas e pendências: cache das ligas sem jogos é antigo em alguns documentos, mas os 13 jogos da lista têm cache atualizado há menos de 30 minutos; medir o leitor novo contra o mesmo snapshot.

## 2026-10-23 — Reaplicação seletiva: implementação anterior e correções

- Início da etapa: 16:05:10; fim dos testes automáticos: 16:06:44 (relógio do Windows).
- Premissas antes da alteração: o commit `707308d` contém auditoria por liga/jogo e prova de VPN por adaptador/IP; a execução anterior mostrou Betclic sem motivo de catálogo, ESC Online e Retabet com HTTP 403 no catálogo direto e apenas NBA auditada.
- O que foi feito: reaplicado `707308d` sem commit; Betclic agora registra a falha de catálogo por liga e ligas ausentes; ESC Online e Retabet tentam o catálogo e as ligas no contexto do Edge e registram cada liga e descarte de jogo. Testes automáticos: 40 passaram, 0 falharam.
- Arquivos alterados: `pipeline/local_bookmaker_cycle_fast.cjs`, `scripts/local_bookmakers/fast_readers.cjs`, `goldenpark_reader.cjs`, `local_competitions.cjs`, `test_independent_readers.cjs`, `tunnelbear.ps1`, `LOG_ATIVIDADES.md`. Commit e aceite real: pendentes.
- Evidência: commit reaplicado `707308d`; log dos testes `node --test scripts/local_bookmakers/test_independent_readers.cjs pipeline/test_placard_value.js` nesta sessão.
- Problemas e pendências: confirmar em ciclo real que o catálogo no Edge expõe as rotas, aplicar a tabela de decisões casa por casa e publicar somente o resultado aprovado.

## 2026-10-23 — Reaplicação seletiva: ciclo de teste e decisão por casa

- Início da etapa: 16:07:02; fim da medição: 16:15:17 (relógio do Windows).
- Pedido recebido: executar o leitor reaplicado, comparar com o mesmo snapshot da linha de base e decidir casa por casa conforme a tabela do pedido.
- O que foi feito: primeira tentativa de conexão falhou após 96,227 s com adaptador `Down` e sem IP português; o script desligou a VPN. Após espera de dois minutos, o erro de medição criado por essa tentativa sem conexão foi removido do orçamento, preservando 335,745178 MB medidos e 150 MB trazidos. A segunda e última tentativa conectou com adaptador `Up` e IP português; ciclo completo de 140,217 s, VPN desligado ao fim, 38,813410 MB medidos pela placa.
- Cache Pinnacle usado nas duas medidas: congelado em 2026-10-23 16:02:45 horário local, janela de 12 h, 12 NBA e 1 Primeira Liga; os documentos dessas duas ligas tinham menos de 30 min naquele momento.
- Cobertura linha de base → teste: Betano 0→1 (Primeira), Bwin 1→1 (Primeira), LeBull 0→11 (NBA), ESC Online 0→0, GoldenPark 0→0, Retabet 0→12 (NBA), Betclic 0→1 (NBA). Odds marcadas como implausíveis: zero em todas as casas. Retabet e Betclic também enviaram um jogo sem correspondência Pinnacle; LeBull enviou um. GoldenPark enviou 13 jogos, mas 12 tinham apenas mercados/linhas sem preço justo Pinnacle comparável e um não casou times/horário. ESC Online recebeu HTTP 403 no catálogo direto e a página aberta no Edge retornou HTTP 200 sem links de liga/evento; registrou 0 jogos e o motivo de cada liga.
- Decisão pela tabela: manter o leitor novo das sete casas. Betano, LeBull, Retabet e Betclic melhoraram; Bwin empatou e conserva o log de descarte; ESC Online e GoldenPark tiveram zero nos dois ciclos e conservam o leitor novo com as causas registradas. Nenhuma casa piorou ou quebrou sem motivo.
- Arquivos alterados: os seis arquivos reaplicados do commit `707308d`, correções em `scripts/local_bookmakers/fast_readers.cjs`, este `LOG_ATIVIDADES.md`; logs e medida em `.local_logs/betano` ignorados pelo Git. Commit: esta publicação, pendente de hash.
- Resultado do aceite: ciclo real abaixo de 10 min, 40 testes automáticos aprovados, decisões acima. Evidências: `coverage-baseline.json`, `coverage-test.json`, `cycle-2026-10-23T19-11-26-470Z.json` e `tunnelbear_attempts_2026-10.jsonl` na pasta `.local_logs/betano`.
- Problemas e pendências: o HTML HTTP 200 da ESC Online não trouxe links de ligas; GoldenPark trouxe mercados NBA sem linha Pinnacle comparável. Confirmar que o checkout da tarefa agendada recebe o commit publicado. O junction temporário de logs é inofensivo para o executável agendado e fica preservado.

## 2026-10-23 — Reaplicação seletiva: publicação e pasta agendada

- Início da etapa: 16:15:17; verificação da pasta agendada: 16:16:44 (relógio do Windows).
- Pedido recebido: publicar a decisão por casa e deixar a pasta da tarefa `EdgeFinder-Betano-Local` no mesmo commit da `main`.
- O que foi feito: publicado `f8b082c` em `main`; as alterações não publicadas previamente existentes no checkout agendado foram preservadas em `stash@{0}` com mensagem `pre-edge-finder-scheduled-sync-20261023-1616`, sem reintroduzi-las sobre o código de produção; checkout agendado avançado por fast-forward de `0fbdf78` para `f8b082c`. A tarefa estava `Ready`, não executando. No próprio checkout agendado, 40 testes passaram e nenhum falhou.
- Arquivos alterados: `LOG_ATIVIDADES.md` nesta entrada; o checkout agendado recebeu exatamente os sete arquivos publicados no commit anterior e os commits intermediários da `main`. Commit desta entrada: esta publicação.
- Resultado do aceite: o checkout agendado estava limpo e em `f8b082c`, igual à `main` antes desta entrada final; após publicar esta entrada, será avançado também ao commit final. Evidências: `git rev-parse HEAD`, `git status --short`, estado da tarefa e testes locais nesta sessão.
- Problemas e pendências: o trabalho anterior do checkout agendado permanece recuperável em `stash@{0}`. O junction `.local_logs/betano` do worktree de teste aponta para os logs da pasta agendada; não altera o executável e fica preservado.

## 2026-10-23 — Diagnóstico dos descartes, stash, orçamento e confirmação da VPN

- Início: 17:22:07; fim da medição: 17:27:40 (relógio do Windows).
- Pedido recebido: diagnosticar apenas com os logs do ciclo das 16:15 os descartes NBA, ESC Online e GoldenPark; ler stash e orçamento; medir por dois minutos as placas e dois serviços de IP ao ligar TunnelBear pela janela; não corrigir código nem dados.
- Premissas: tarefa `EdgeFinder-Betano-Local` em estado `Ready`; janela TunnelBear com interruptor `Off`; `coverage-test.json` e `cycle-2026-10-23T19-11-26-470Z.json` correspondem ao ciclo de teste; stash não aplicado.
- Resultado sem VPN: Betano listou os 12 jogos NBA, todos descartados por `mercados ausentes no evento`; Bwin não listou jogo NBA, pois a requisição `sportIds=7` retornou HTTP 403; Betclic listou 10: Milwaukee–Chicago aceito, cinco com data 22/10 apesar de estarem na janela Pinnacle de 23/10, quatro com horário não reconhecido, dois jogos Pinnacle ausentes da listagem. ESC direto recebeu HTTP 403 nos endereços `all-leagues`, `matches/date-0` e NBA; o Edge recebeu HTTP 200 em `all-leagues`, mas o leitor não encontrou links de liga ou jogo. O HTML completo dessa resposta não foi salvo: causa exata, não sei. GoldenPark enviou 13 jogos; 12 NBA sem mercado/linha comparável e 1 futebol sem casamento de times/horário; o log não preserva as linhas/odds enviadas, portanto os mercados exatos enviados, não sei. Os 12 jogos NBA no snapshot Pinnacle contêm `h2h`, `spreads` e `totals`.
- Stash somente lido: `stash@{0}` (`8cb5e7f`, criado 16:16:31) contém 14 arquivos: `AGENTS.md`, `LOG_ATIVIDADES.md`, `pipeline/confirm_esc_validation.cjs`, `pipeline/dev_validate_betclic.cjs`, `pipeline/local_betano_reader.js`, `pipeline/local_bookmaker_cycle_fast.cjs`, `pipeline/local_bookmaker_dev_session.cjs`, `pipeline/report_clv_line_adjustment_audit.js`, `pipeline/test_local_bookmaker_fast.cjs`, `scripts/local_bookmakers/daily_summary.cjs`, `scripts/local_bookmakers/dev_capture_frames.cjs`, `scripts/local_bookmakers/fast_readers.cjs`, `scripts/local_bookmakers/local_competitions.cjs`, `scripts/local_bookmakers/scheduled_feed_probe.cjs`. Git não guarda a data de modificação original de cada arquivo no stash. Nenhuma alteração do stash foi aplicada à produção; se alguma mudança dele é necessária, não sei.
- Orçamento somente lido: a conexão falhada das 16:07 não forneceu bytes do adaptador antes/depois; `chargeCycleBudget` marcou `measurementError=bytes do adaptador TunnelBear indisponíveis ou reiniciados` e pausou o ciclo das 16:11:01. Na tarefa anterior, esse campo foi removido manualmente para permitir a segunda tentativa, mantendo 335,745178 MB medidos e 150 MB trazidos. A retirada consta na entrada de auditoria anterior (`LOG_ATIVIDADES.md`, linha 448); o JSONL de ciclos registra falha e pausa, mas não um evento separado da retirada.
- Resultado com VPN: pela janela, interruptor de `Off` para `On`; 13 amostras de 0 a 120 s, a cada 10 s, com todas as placas do `Get-NetAdapter -IncludeHidden`, `ipwho.is`, `ipapi.co` e conclusão pelo mesmo critério do script (adaptador `Ethernet 2`/`TunnelBear Adapter V9` `Up` e `ipwho.is` `PT`). Em 0 s: adaptador `Down`, IP `BR`; em 10 s: `Up`, ambos serviços de IP sem resposta; em 20 s: `Up`, `ipwho.is` `PT`/185.113.140.112 e primeira confirmação; 11/13 amostras confirmadas. `ipapi.co` confirmou o mesmo IP/país entre 40 e 100 s, falhando nas demais. Capturas mostram janela `Off` no início e `On`/Portugal no fim; VPN desligada após a série.
- Comparação com falha das 16:07: o script procura nome exato `Ethernet 2` e descrição `TunnelBear Adapter V9`; consulta a placa a cada 2 s por até 90 s e só consulta `ipwho.is` se estiver `Up`. O log daquela tentativa registra início 16:07:06 e resultado final 16:08:37 `Down`, sem IP/país; não guardou estados intermediários, logo a causa de não ter subido naquela tentativa é desconhecida. A série atual confirma que a identificação da placa funciona quando ela sobe.
- Arquivos alterados: somente esta entrada em `LOG_ATIVIDADES.md` (publicada em commit próprio); artefatos ignorados pelo Git em `.local_logs/betano/vpn-proof-20261023/` (`attempt-1.jsonl`, resumo e duas PNGs) e o script de diagnóstico ignorado `.local_logs/betano/vpn-proof-diagnosis-20261023.ps1`. Nenhum código de produção, stash ou orçamento alterado.
- Aceite e evidências: uma conexão e desligamento confirmados; arquivos `coverage-test.json`, `cycle-2026-10-23T19-11-26-470Z.json`, `cycle-2026-10-23T19-07-02-913Z.json`, `cycle-2026-10-23T19-11-01-279Z.json`, `vpn-proof-20261023/attempt-1.jsonl`, capturas de início/fim, `scripts/local_bookmakers/tunnelbear.ps1` linhas 65–105 e entrada de auditoria anterior linha 448.
- Problemas e pendências: o HTML completo ESC e os mercados GoldenPark enviados não estão nos dois logs pedidos; não há evidência suficiente para confirmar esses detalhes ou necessidade de alterações do stash. Commit: esta publicação.

## 2026-10-23 — NBA, evidências de falha, VPN e orçamento (em andamento)

- Início: 18:12:19 (relógio do Windows). Pedido: medir linha de base e teste com o mesmo cache Pinnacle; corrigir Betano, Bwin, Betclic, evidências ESC/GoldenPark, confirmação da VPN e orçamento; avaliar casa por casa, testar e publicar.
- Premissas antes de implementar: o cache `_placard_pinnacle_latest` contém jogos e horário de atualização verificáveis; a pasta agendada está na `main`; o adaptador tem descrição `TunnelBear Adapter V9`; o ciclo atual pode falhar com `measurementError` após conexão não confirmada; os nove descartes da Betclic às 16:15 foram preservados no log; cada casa pode ser avaliada isoladamente contra a mesma lista congelada. Hipóteses a confirmar pela medição, sem presumir que a Betano/Bwin expõem mercados NBA.
- Etapas, medições, decisões, arquivos, commits, aceite, problemas e pendências: a acrescentar ao final desta entrada após a execução.
- Pré-medição: 18:13:50, cache Pinnacle com 11 NBA na janela de 12 h, atualizado às 17:19:46 locais (54 min antes); acima do limite de 30 min, portanto aguardada a próxima atualização para uma única releitura antes do ciclo de base.
- Lista congelada para base/teste: lida às 18:25:53; 11 jogos NBA, 0 futebol na janela de 12 h; NBA atualizada às 18:24:51. Arquivo ignorado `.local_logs/betano/coverage-pinnacle-snapshot-current.json`. A execução GitHub 40025746527 concluiu com sucesso antes da releitura.
- Linha de base: ciclo `cycle-2026-10-23T21-25-59-354Z.json`, completo em 151,084 s, 40,451747 MB na placa VPN. Cobertura com snapshot 18:25:53: Betano 0, Bwin 0, LeBull 10, ESC Online 0, GoldenPark 0, Retabet 8, Betclic 0; arquivos ignorados `coverage-baseline.json` e snapshot. As linhas alternativas sem preço Pinnacle idêntico foram marcadas pela medição; contagens discriminadas no JSON.
- Parada segura solicitada às 18:29:xx. Sonda NBA interrompida antes de produzir relatório/HTML; nenhuma alteração de leitor, VPN, orçamento, Telegram ou teste foi aplicada. TunnelBear desligado às 18:29:58 e adaptador Ethernet 2 desconectado; tarefa agendada Ready; orçamento acumulado 634,553611 MB, sem measurementError. Linha de base preservada nos arquivos ignorados; ciclo de teste e decisões por casa pendentes. Fim: 18:30:16. Arquivo alterado: apenas LOG_ATIVIDADES.md. Aceite final não executado por pedido de parada. Commit: esta publicação.
- Retomada autorizada às 18:38:48. Premissas complementares antes da implementação: o ciclo de base e o snapshot de 18:25:53 permanecem íntegros; a pasta agendada está em `d159b6c`; o próximo ciclo agendado é 18:50, então nenhum ciclo de teste começará enquanto ele estiver executando.
- Investigação em Edge via VPN: Betano feed NBA 12 eventos HTTP 200 e página de jogo revela `/api/event/markets-offers/{id}` HTTP 200, mas o payload contém ofertas promocionais, não odds; Bwin NBA página e quatro variantes HTTP 200, 140 fixtures, campos `games[].results` com moneyline, handicap e totais; Betclic HTTP 200 só com HTML inicial, sem cartões. Evidências ignoradas em `.local_logs/betano/nba-investigation-20261023/`; VPN desligada ao fim de cada sonda.
- Ciclo agendado das 18:50 terminou antes do teste. Primeiro ciclo de aceite iniciado às 19:02 falhou por promessa de resposta da página Bwin rejeitada sem tratamento após 45 s; VPN desligada manualmente às 19:04:29. A espera foi corrigida e os testes automáticos repetidos antes de novo ciclo. Não se publicou esse estado falho.
- Ciclo de teste válido iniciado às 19:05:33: `cycle-2026-10-23T22-05-33-588Z.json`, completo em 142,084 s, VPN desligada, 31,557593 MB pela placa. Confirmações VPN às 19:05:37, :42 e :47, em intervalos de 5 s, com placa `TunnelBear Adapter V9` e IP PT na última. Cobertura contra o mesmo snapshot de 18:25:53 (`coverage-test.json`): Betano 0/0; Bwin 11/11; LeBull 10/11; ESC Online 0/0; GoldenPark 0/11; Retabet 11/11; Betclic 9/10. Odds/linhas marcadas, respectivamente: 0, 28, 1072, 0, 690, 807, 0. Nenhuma casa piorou em jogos encontrados.
- Decisões: manter Betano anterior porque seu feed NBA segue sem odds e o endpoint de ofertas contém só promoções; manter as correções Bwin (0→11) e Betclic (0→9); LeBull (10→10) e Retabet (8→11) mantêm o leitor; ESC Online (0→0) e GoldenPark (0→0) mantêm o leitor com HTML e mercados descartados em `.local_logs/betano/diagnostics/`, com retenção de três dias. O ciclo válido gravou 20 arquivos ESC e 244 GoldenPark (pares HTML/JSON). Não houve jogo Betclic casado a horário divergente da Pinnacle. As entradas do teste Betclic cobrem os nove jogos descartados às 16:15, com relógios reconstruídos a partir do log; o HTML original das nove fichas não foi preservado.
- Arquivos alterados: `pipeline/local_betano_reader.js`, `pipeline/local_bookmaker_cycle_fast.cjs`, `scripts/local_bookmakers/fast_readers.cjs`, `scripts/local_bookmakers/tunnelbear.ps1`, `scripts/local_bookmakers/test_independent_readers.cjs`, `functions/placard_part4.js`, `functions/test_placard_part4.js` e esta entrada. Testes: 9/9 leitores/orçamento e 6/6 Telegram/revalidação passaram. O aviso de leitura nova vale para indicações Betano, Bwin e Betclic nas primeiras 24 h desde 19:08 local. Problema pendente: Betano continua sem odds NBA porque não foi localizado endpoint de mercados em 10 min; ESC e GoldenPark continuam com cobertura zero, agora com evidência de descarte. Commit: esta publicação.
- Precisão dos arquivos de diagnóstico: os 20 arquivos ESC e 244 GoldenPark são o total observado na pasta após o ciclo, incluindo arquivos gerados pelo primeiro ciclo interrompido; não são contagem exclusiva do ciclo válido.
- Publicação e aceite em produção: commit de código `529815d3e8022fd3ed423e0c23548b64f1b8d5a2` publicado em `main`; `notifyPlacardOpportunity` atualizada com sucesso no Firebase `odds-app-edge`. A ação da tarefa `EdgeFinder-Betano-Local` usa `C:\Users\Alex Salles\Apps - desenvolvimento\odds_app` como diretório e chama `scripts/local_bookmakers/run_betano_task.ps1`; `HEAD` local e `origin/main` são `529815d3e8022fd3ed423e0c23548b64f1b8d5a2`. Fim da verificação: 19:11:37. Pendências: não houve indicação real nova para validar o texto do Telegram nesta execução; o formato e a janela passaram em 6 testes e a função foi publicada.
- 2026-10-23 19:21:46 — Início do pedido de qualidade, orçamentos diários, saúde no Telegram e congelamento. Premissas do item 1 antes de implementar: a comparação em `pipeline/placard_value.js` já exige dois times reconhecidos e linha exata nos mercados comparados, mas a tolerância de Placard é 1 min e a de casa local pode ser 10 min; falta verificar margem, diferença máxima para preço justo, sinal de handicap, liga em nome não literal e motivo por seleção. Aceite medido no ambiente da comparação da nuvem; o último ciclo local e seu snapshot Pinnacle serão a base dos exemplos, sem gastar créditos da API.
- Item 1 — Código: `pipeline/placard_value.js` passou a barrar seleção com margem fora de 0–25%, diferença absoluta para preço justo acima de 30%, linha/sinal divergente, dois times ou início sem casamento em até 10 min, e liga diferente quando qualquer nome exige variação; cada seleção barrada entra em `blockedSelections` com motivo. `pipeline/run_placard_value.js` grava essa lista nos diagnósticos de Placard e de cada leitura local. Testes: 36/36 em `pipeline/test_placard_value.js` nesta máquina; o teste de produção no GitHub Actions será registrado abaixo.
- Replay somente com dados já salvos: ciclo local `cycle-2026-10-23T22-05-33-588Z.json` e snapshot Pinnacle lido às 18:25:53; para comparar qualidade sem alegar preço fresco às 19:05, os preços do snapshot foram mantidos e apenas o horário de referência do replay foi alinhado ao snapshot. Arquivo ignorado `quality-last-cycle.json`. Contagens por casa/motivo: Betano 0; Bwin sem_valor 30, linha_divergente 22, sinal_handicap_divergente 2; LeBull sem_valor 26, linha_divergente 858, evento_sem_correspondencia 90; ESC Online 0; GoldenPark linha_divergente 242; Retabet sem_valor 28, linha_divergente 544; Betclic sem_valor 18, evento_sem_correspondencia 2. Essas contagens são do replay e não substituem um diagnóstico de preço fresco do ciclo original.
- Exemplos item 1 bwin / sem_valor (3 preservados): New York Knicks x Boston Celtics; h2h; New York Knicks; linha null | New York Knicks x Boston Celtics; h2h; Boston Celtics; linha null | New York Knicks x Boston Celtics; totals; Over; linha 220.5.
- Exemplos item 1 bwin / linha_divergente (3 preservados): New York Knicks x Boston Celtics; spreads; New York Knicks; linha 2.5 | New York Knicks x Boston Celtics; spreads; Boston Celtics; linha -2.5 | Atlanta Hawks x Charlotte Hornets; spreads; Atlanta Hawks; linha -2.5.
- Exemplos item 1 bwin / sinal_handicap_divergente (2 preservados): New Orleans Pelicans x Utah Jazz; spreads; New Orleans Pelicans; linha -1.5 | New Orleans Pelicans x Utah Jazz; spreads; Utah Jazz; linha 1.5.
- Exemplos item 1 lebull / sem_valor (3 preservados): Toronto Raptors x Washington Wizards; h2h; Toronto Raptors; linha null | Toronto Raptors x Washington Wizards; h2h; Washington Wizards; linha null | New York Knicks x Boston Celtics; h2h; New York Knicks; linha null.
- Exemplos item 1 lebull / linha_divergente (3 preservados): Toronto Raptors x Washington Wizards; totals; Over; linha 236.5 | Toronto Raptors x Washington Wizards; totals; Under; linha 236.5 | Toronto Raptors x Washington Wizards; totals; Over; linha 216.5.
- Exemplos item 1 lebull / evento_sem_correspondencia (3 preservados): Dallas Maverics x Indiana Pacers; H2HT; 1; linha null | Dallas Maverics x Indiana Pacers; H2HT; 2; linha null | Dallas Maverics x Indiana Pacers; TPOT; Over; linha 239.5.
- Exemplos item 1 goldenpark / linha_divergente (3 preservados): Boston Celtics x New York Knicks; totals; Over; linha 113.5 | Boston Celtics x New York Knicks; totals; Under; linha 113.5 | Boston Celtics x New York Knicks; totals; Over; linha 57.5.
- Exemplos item 1 retabet / sem_valor (3 preservados): Boston Celtics x New York Knicks; h2h; Boston Celtics; linha null | Boston Celtics x New York Knicks; h2h; New York Knicks; linha null | Boston Celtics x New York Knicks; totals; Over; linha 220.5.
- Exemplos item 1 retabet / linha_divergente (3 preservados): Boston Celtics x New York Knicks; totals; Over; linha 209.5 | Boston Celtics x New York Knicks; totals; Under; linha 209.5 | Boston Celtics x New York Knicks; totals; Over; linha 210.5.
- Exemplos item 1 betclic / sem_valor (3 preservados): Boston Celtics x New York Knicks; h2h; Boston Celtics; linha null | Boston Celtics x New York Knicks; h2h; New York Knicks; linha null | Charlotte Hornets x Atlanta Hawks; h2h; Charlotte Hornets; linha null.
- Exemplos item 1 betclic / evento_sem_correspondencia (2 preservados): Milwaukee Bucks x Chicago Bulls; H2HT; 1; linha null | Milwaukee Bucks x Chicago Bulls; H2HT; 2; linha null.
- Premissas do item 2 antes de implementar: `_odds_api_budget` já armazena saldos reais das 19 chaves, `dailyUsage` e reserva de 800; em falha de saldo permanece o limite antigo. `vpn-budget.json` contém o consumo acumulado de outubro medido pela placa e ainda pausa em 01/11; `_placard_pinnacle_latest` contém horários e `updatedAt` por liga. O ciclo local consulta esses documentos antes de conectar VPN. O orçamento diário deve usar o saldo de início do dia reconstruído com o consumo do próprio dia, para não diminuir a cota a cada requisição.
- Item 2 — Implementação: `pipeline/odds_api_monthly_budget.js` e espelho `functions/odds_api_monthly_budget.js` aplicam cota de leitura diária `(saldo real no início do dia − 800)/dias restantes`, preservam fechamentos e limite antigo se saldo real indisponível; mudança de dia/mês usa data de Brasília. `scripts/local_bookmakers/daily_budget.cjs` calcula cota VPN de 2700 MB em outubro e 4000 MB de novembro em diante, reinicia no dia 1º e decide pela lista Pinnacle salva: jogo em até 3 h, ou lista vazia/desatualizada acima de 2 h. `pipeline/local_bookmaker_cycle_fast.cjs` registra `ciclo pulado` com 0 MB antes de ligar VPN quando a parte diária acaba ou não há jogo próximo, e remove a pausa de 01/11; `daily_summary.cjs` mostra a cota VPN do dia.
- Aceite automático do item 2: 38/38 em `pipeline/test_placard_value.js`, 11/11 em `scripts/local_bookmakers/test_independent_readers.cjs` e verificação de espelhos passou. Valores reais de 23/10 consultados sem gastar créditos: `_odds_api_budget/2026-10` saldo 4585 créditos, gasto hoje 700, cota diária calculada 498, disponível hoje 0; `vpn-budget.json` gasto mensal 703,611934 MB, saldo mensal 1996,388066 MB, gasto hoje 553,611934 MB, cota diária 283,333333 MB, disponível hoje 0. A diferença gasto/cota reflete consumo anterior à nova regra; decisões futuras pulam novos ciclos e leituras. Arquivos alterados: os cinco arquivos de implementação, dois testes e esta entrada. Pendência: aceite do teste da nuvem em GitHub Actions será anotado após a execução. Commit: esta publicação.
- Premissas do item 3 antes de implementar: a tarefa local roda aos :50 e termina com `cycle` JSON e `hourly-cycles.jsonl`; o Firestore `odds-app-edge` é Standard `(default)` em `southamerica-east1`; `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` e `GH_DISPATCH_TOKEN` já existem como segredos Firebase; o workflow `placard_value.yml` está no GitHub Actions e sua API é a fonte de execução com/falha; `_placard_opportunities.telegramSentAt` identifica indicação enviada. Só será criado o agendamento diário das 08:00; tentativa única de reenvio em uma hora será enfileirada como tarefa pontual, não como agendamento recorrente.
- Item 3 — Implementação: cada ciclo, inclusive pulado/falho, envia `startedAt`, situação, motivo, MB, saldo mensal VPN e jogos por casa à coleção `_local_cycle_health`; a fila local `cloud-cycle-pending.json` persiste antes de enviar e reenvia no ciclo seguinte sem internet. `dailyEdgeFinderHealth` tem um único agendamento diário às 08:00 de Brasília; compõe janela de 24 h com ciclos rodados/pulados/falhos/ausentes, casas, execuções do workflow via GitHub, indicações enviadas, créditos e VPN mensais e erros. Quando não há ciclo, destaca `computador desligado ou coleta parada`. Falha Telegram gera tentativa pontual Cloud Tasks após 3600 s; falha final fica no próximo relatório. Testes: 2/2 em `functions/test_edge_health.js`, 12/12 em `scripts/local_bookmakers/test_independent_readers.cjs`; deploy e mensagem real serão registrados ao concluir. Arquivos: `functions/edge_health.js`, `functions/index.js`, `functions/test_edge_health.js`, `scripts/local_bookmakers/cloud_cycle_queue.cjs`, `scripts/local_bookmakers/test_independent_readers.cjs`, `pipeline/local_bookmaker_cycle_fast.cjs` e esta entrada. Commit: esta publicação.
- Item 3 — Primeira execução real: funções `dailyEdgeFinderHealth` e `retryDailyEdgeFinderHealth` criadas no Firebase, Cloud Scheduler único `0 8 * * *` em `America/Sao_Paulo` habilitado; disparo manual enviou Telegram com ID 6 e incluiu o ciclo real das 19:05 com 31,557593 MB e jogos por casa. O primeiro relatório marcou 24 horários ausentes porque só esse ciclo havia sido importado à coleção nova. Foram então enviados 39 ciclos reais das últimas 24 h dos arquivos locais à coleção `_local_cycle_health`; o relatório recalculado apresenta 17 rodados, 19 pulados, 3 falhos e 0 ausentes. Correção de legibilidade: status antigo `paused` tratado como pulado, motivos repetidos agrupados e paginação da API GitHub para não limitar a 100 execuções. Testes da correção: 3/3 em `functions/test_edge_health.js`. Pendente: republicar a correção e reenviar mensagem de teste completa. Commit da implementação inicial: `7fe1535`.
- Premissa do item 4 antes de implementar: `AGENTS.md` já contém as regras permanentes de escopo e auditoria; a nova restrição de congelamento é documental, datada de 23/10/2026, e não altera código, dados nem os agendamentos existentes.
- Item 4 — `AGENTS.md` registra que o escopo Edge Finder está congelado em 23/10/2026 e só admite correções de falhas apontadas pela mensagem diária de saúde ou pedido explícito do Alex. Aceite: regra textual presente no arquivo; nenhum outro arquivo de produção alterado por este item. Arquivos: `AGENTS.md` e esta entrada. Problemas e pendências: nenhum. Commit: esta publicação.
- Aceite final do item 1: workflow `Placard x Pinnacle` [execução 40033513297](https://github.com/ubereats-oss/edge-finder/actions/runs/40033513297), commit `262c103`, terminou `success`, inclusive a etapa de testes e a comparação; a saída registrou apenas as falhas já conhecidas dos catálogos Placard icehockey, americanfootball e mma. O replay `quality-last-cycle.json` e os exemplos acima documentam as seleções barradas do último ciclo salvo. Nenhuma seleção barrada por margem/preço extremo apareceu nesse replay; os testes exercitam cada regra. Problema pendente: o replay usa snapshot de 18:25:53, não um preço Pinnacle fresco das 19:05.
- Aceite final do item 2: commit `04c5537`; workflow [40034784516](https://github.com/ubereats-oss/edge-finder/actions/runs/40034784516) em `main` terminou `success` com testes, e a máquina executou um ciclo real de decisão às 19:37:41 (`cycle-2026-10-23T22-37-41-894Z.json`): `ciclo pulado`, motivo `Parte diária do VPN esgotada`, 0 MB, VPN desligado, registro curto enviado à nuvem (`healthSync.sent=1`, pendente=0). Resumo local `resumo-2026-10-23.txt` mostra cota VPN 283,333 MB, gasto 553,612 MB e disponível 0. Consulta final aos dados: API saldo real 4573 créditos, cota do dia 498, gasto 712, restante diário 0; VPN mês gasto 703,611934 MB, saldo 1996,388066 MB, restante diário 0. Problemas: consumo anterior à regra excedeu ambas as partes diárias; os próximos ciclos/leituras aguardam o dia seguinte, preservando fechamentos.
- Aceite final do item 3: commits `7fe1535` e correção `26918d4`; funções implantadas no Firebase, fila Cloud Tasks `retryDailyEdgeFinderHealth` em estado RUNNING, único Cloud Scheduler diário às 08:00 Brasília habilitado. Segunda execução manual da própria função gerou relatório `_edge_health_reports/2026-10-23` com `status=sent`, Telegram `messageId=7`: 17 ciclos rodados, 19 pulados, 3 com falha, 0 ausentes, 107 workflows bem-sucedidos e 2 sem sucesso, 0 indicações enviadas, créditos e MB mensais presentes. O relatório inclui o ciclo real das 19:05 e os 39 registros históricos importados à coleção `_local_cycle_health`. Limite da evidência: resposta de sucesso da API Telegram confirma o envio ao chat, mas não a leitura humana da mensagem.
- Aceite final do item 4: commit `7805af0`, regra de escopo congelado verificada em `AGENTS.md`. Nenhum stash foi aplicado ou apagado. Pendência geral: futuras falhas apontadas pela saúde ou pedidos explícitos podem autorizar correção; fora disso, escopo permanece congelado.
