// pipeline/sync_pt_odds_checks.js
// Sincroniza conferências de odds de casas PT marcadas como "aposta feita"
// (tela "Conferir odds" do app, coleção Firestore odds_checks) pro histórico
// central de indicações — reaproveitando sem nenhuma mudança o mecanismo já
// existente de captura de odd de fechamento (capture_closing_odds.js,
// closing_odds_rules.js) e apuração de resultado (settle_model_ledger.js).
//
// Gravado com source:'pt_odds_check' — fica de fora da calibração
// automática (calibration.js) e do relatório de desempenho do modelo
// (generate_report.js), que explicitamente excluem essa origem. modelProb/
// rawProb aqui são a probabilidade justa da Pinnacle (método de potência),
// não uma calibração do modelo.
//
// Idempotente: upsert por chave (evento+jogador+mercado+linha+lado), seguro
// rodar de novo se uma execução anterior falhar depois de gravar no ledger
// mas antes de marcar o documento como sincronizado.
//
// Uso: node pipeline/sync_pt_odds_checks.js
// Precisa de FIREBASE_SERVICE_ACCOUNT no ambiente.

const admin = require('firebase-admin');
const ledger = require('./model_ledger');
const riskConfig = require('./risk_config');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('FIREBASE_SERVICE_ACCOUNT ausente — pulando sincronização de conferências de odds PT.');
  process.exit(0);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

// Kelly já vem calculado (25% fixo, igual risk_config.KELLY_FRACTION) e
// gravado pelo app no momento da conferência — aqui só repassamos pro
// ledger, nunca recalculamos nem alteramos a fração.
function kellyPercentOf(doc) {
  return typeof doc.kellyPct === 'number' ? doc.kellyPct : null;
}

async function main() {
  const snap = await db.collection('odds_checks').where('apostaFeita', '==', true).get();
  const pendentes = snap.docs.filter(d => d.data().syncedToLedger !== true);

  if (!pendentes.length) {
    console.log(`Nenhuma conferência marcada como feita pendente de sincronização (${snap.size} feita(s) no total, já sincronizadas).`);
    return;
  }

  console.log(`${pendentes.length} conferência(ões) marcada(s) como feita pendente(s) de sincronização.`);
  let gravadas = 0;

  for (const doc of pendentes) {
    const d = doc.data();
    if (!d.esporte || d.eventId == null || d.player == null || d.market == null || d.line === undefined || !d.side) {
      console.warn(`  Pulando ${doc.id} — campos obrigatórios ausentes.`);
      continue;
    }

    ledger.recordEvaluation({
      esporte: d.esporte,
      eventId: d.eventId,
      game: d.game,
      commenceTime: d.commenceTime,
      player: d.player,
      market: d.market,
      line: d.line,
      side: d.side,
      // Probabilidade justa da Pinnacle (método de potência) no momento da
      // conferência — não é calibração do modelo.
      modelProb: d.fairProbPct,
      rawProb: d.fairProbPct,
      odds: d.oddDigitada,
      bookmaker: d.bookmaker,
      edge: d.edgePct,
      kelly: kellyPercentOf(d),
      published: true,
      source: 'pt_odds_check',
      hasModelProb: true,
      validForCalibration: true,
      runId: new Date().toISOString(),
    });

    const indicationId = ledger.indicationId({
      eventId: d.eventId, player: d.player, market: d.market, line: d.line, side: d.side,
    });
    await doc.ref.update({ syncedToLedger: true, indicationId, syncedAt: admin.firestore.FieldValue.serverTimestamp() });
    gravadas++;
  }

  const summary = ledger.flush();
  console.log(`${gravadas} conferência(ões) gravada(s) no histórico central (${summary.partitionsSaved} partição(ões) atualizada(s)). Kelly reaproveitado de risk_config.KELLY_FRACTION=${riskConfig.KELLY_FRACTION} (calculado no app, só repassado aqui).`);
}

main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });
