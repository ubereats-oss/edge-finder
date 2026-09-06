#!/usr/bin/env bash
# .github/scripts/save_stats_gz.sh <esporte> <novo_gz> <caminho_no_repo>
#
# Decide se um snapshot de stats comprimido (.gz) recém-gerado deve
# substituir o que já está commitado na branch de dados, ou se deve ser
# mantido como está. Assume que a compressão já foi feita de forma
# determinística (gzip -n), então a única razão pra dois arquivos
# diferirem é o conteúdo ter realmente mudado.
#
# Chamar DEPOIS do checkout da branch de dados (pra que <caminho_no_repo>,
# se existir, seja a versão já commitada).
#
# Uso: save_stats_gz.sh nba /tmp/to-save/nba_player_stats.json.gz nba_player_stats.json.gz

set -uo pipefail

esporte="$1"
novo="$2"
alvo="$3"

# Sem coleta nesta execução (esporte fora de temporada, ou falha antes de
# chegar aqui) — não há nada novo pra considerar, mantém o que já existe.
if [ ! -s "$novo" ]; then
  echo "[stats:$esporte] mantido — sem coleta nesta execução ($novo ausente ou vazio)."
  exit 0
fi

# Nada commitado ainda pra esse esporte — primeira versão.
if [ ! -f "$alvo" ]; then
  cp "$novo" "$alvo"
  echo "[stats:$esporte] atualizado — primeira versão commitada ($alvo não existia)."
  exit 0
fi

old_size=$(wc -c < "$alvo")
new_size=$(wc -c < "$novo")

# Guarda contra coleta parcial/falha na fonte: se o novo arquivo ficou bem
# menor que o já commitado, é mais provável que a coleta tenha falhado no
# meio do que a base de jogadores ter encolhido de verdade — não sobrescreve.
if [ "$old_size" -gt 0 ]; then
  ratio_pct=$(( new_size * 100 / old_size ))
  if [ "$ratio_pct" -lt 50 ]; then
    echo "[stats:$esporte] mantido — coleta desta execução parece parcial (${new_size} bytes vs ${old_size} bytes já commitados, ${ratio_pct}%); não sobrescrevendo um arquivo bom com um incompleto."
    exit 0
  fi
fi

if cmp -s "$novo" "$alvo"; then
  echo "[stats:$esporte] mantido — conteúdo idêntico ao já commitado na branch de dados (compressão determinística confirma sem mudança)."
  exit 0
fi

cp "$novo" "$alvo"
echo "[stats:$esporte] atualizado — conteúdo mudou em relação ao já commitado (${old_size} -> ${new_size} bytes)."
