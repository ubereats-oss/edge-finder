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
