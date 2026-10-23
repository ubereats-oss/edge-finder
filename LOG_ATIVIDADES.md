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
