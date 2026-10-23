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
