const integrity = require('../functions/market_integrity');
const model = require('./placard_value');

function auditPositiveEdges(entries) {
  return entries.filter(entry => !integrity.isAnnulled(entry)).map(entry => ({ id: entry.id,
    game: entry.game, bookmaker: entry.bookmaker || 'Placard', selection: entry.selection,
    market: entry.market, line: entry.line ?? null, houseOdds: entry.sourceOdds ?? entry.placardOdds,
    pinnacleOdds: entry.pinnacleOdds ?? null, probability: entry.probability,
    fairOdds: 1 / entry.probability,
    ...integrity.assessPositiveEdge(entry.sourceOdds ?? entry.placardOdds, entry.probability),
    annulled: !integrity.assessPositiveEdge(entry.sourceOdds ?? entry.placardOdds, entry.probability).approved }));
}
async function applyPositiveEdgeAudit(db, audit) {
  const auditedAt = new Date().toISOString();
  await db.runTransaction(async tx => {
    const refs = audit.map(row => db.collection('_placard_opportunities').doc(row.id));
    const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
    for (let i = 0; i < audit.length; i++) {
      const row = audit[i], current = snapshots[i].data();
      if (!current || (current.sourceOdds ?? current.placardOdds) !== row.houseOdds || current.probability !== row.probability)
        throw new Error('Odd ou probabilidade mudou desde a auditoria; reler antes de aplicar.');
      const update = { positiveEdgeAudit: { ...row, auditedAt } };
      if (row.annulled) Object.assign(update, { annulled: true, status: 'anulada', closingStatus: 'anulada',
        annulledAt: auditedAt, annulmentReason: integrity.EDGE_REASON,
        annulmentDetail: `vantagem ${row.edgePct}% acima do teto ${row.ceilingPct}%` });
      tx.set(refs[i], update, { merge: true });
    }
  });
  const entries = (await db.collection('_placard_opportunities').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const bets = (await db.collection('bets').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const report = model.report(entries), betReport = model.betClvReport(entries, bets);
  const ref = db.collection('results').doc('placard_current');
  const manifest = (await ref.get()).data() || {};
  await ref.set({ report, betReport, positiveEdgeAuditedAt: auditedAt }, { merge: true });
  if (manifest.runId) {
    const run = ref.collection('runs').doc(manifest.runId);
    await run.set({ report, betReport, positiveEdgeAuditedAt: auditedAt }, { merge: true });
    const annulled = new Set(entries.filter(integrity.isAnnulled).map(row => row.id));
    for (let i = 0; i < (manifest.pageCount || 0); i++) {
      const pageRef = run.collection('pages').doc(String(i));
      const page = (await pageRef.get()).data();
      if (page) await pageRef.set({ rows: (page.rows || []).filter(row => !annulled.has(row.id)) }, { merge: true });
    }
  }
  return { auditedAt, audited: audit.length, annulled: audit.filter(row => row.annulled).length, report };
}
module.exports = { auditPositiveEdges, applyPositiveEdgeAudit };
