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
