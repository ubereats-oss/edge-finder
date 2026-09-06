// pipeline/import_legacy_apostas.js
// Importa o histórico manual em apostas_com_resultados.json (gerado pelo
// fetch_bet_results.js, fora do pipeline) pro histórico central de
// indicações. Essas apostas nunca tiveram uma probabilidade de modelo
// associada — são marcadas com hasModelProb:false e source:'import_...'
// pra ficarem de fora da calibração e das estatísticas de acerto por
// segmento, mas continuam visíveis no histórico geral.
//
// Uso: node pipeline/import_legacy_apostas.js

const fs = require('fs');
const path = require('path');
const ledger = require('./model_ledger');

const LEGACY_FILE = path.join(__dirname, '..', 'apostas_com_resultados.json');

function toIsoDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null;
  const y = yyyymmdd.slice(0, 4), m = yyyymmdd.slice(4, 6), d = yyyymmdd.slice(6, 8);
  return `${y}-${m}-${d}T00:00:00Z`;
}

function toResult(entry) {
  if (entry.status === 'Ganhou') {
    return { status: ledger.RESULT_STATUS.GANHOU, valorReal: entry.valorReal ?? null, apuradoEm: null };
  }
  if (entry.status === 'Perdeu') {
    return { status: ledger.RESULT_STATUS.PERDEU, valorReal: entry.valorReal ?? null, apuradoEm: null };
  }
  return null; // 'Pendente' ou status desconhecido — fica em aberto
}

function main() {
  if (!fs.existsSync(LEGACY_FILE)) {
    console.log('apostas_com_resultados.json não encontrado — nada a importar.');
    return;
  }
  const raw = fs.readFileSync(LEGACY_FILE, 'utf-8').trim();
  const legacy = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(legacy) || !legacy.length) {
    console.log('apostas_com_resultados.json vazio — nada a importar.');
    return;
  }

  let importadas = 0, semData = 0;

  for (const entry of legacy) {
    const commenceTime = toIsoDate(entry.data);
    if (!entry.esporte || !entry.jogador || !entry.prop || entry.linha == null || !entry.lado || !commenceTime) {
      semData++;
      continue;
    }

    const result = toResult(entry);

    ledger.recordEvaluation({
      esporte: entry.esporte,
      eventId: `${entry.jogo}|${entry.data}`,
      game: entry.jogo,
      commenceTime,
      player: entry.jogador,
      market: entry.prop,
      line: entry.linha,
      side: entry.lado,
      modelProb: null,
      odds: entry.odd ?? null,
      bookmaker: null,
      edge: null,
      kelly: null,
      published: null,
      rejectionReason: null,
      runId: 'import_legacy_apostas',
      source: 'import_apostas_com_resultados',
      hasModelProb: false,
      result,
      resolutionStatus: result ? ledger.RESOLUTION_STATUS.RESOLVIDO : ledger.RESOLUTION_STATUS.PENDENTE,
      resolutionAttempts: 0,
    });
    importadas++;
  }

  const summary = ledger.flush();
  console.log(`Importadas: ${importadas} | sem dado suficiente: ${semData} | partições atualizadas: ${summary.partitionsSaved} | duplicadas: ${summary.duplicatesInRun}`);
}

main();
