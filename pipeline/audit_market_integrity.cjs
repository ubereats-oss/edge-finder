const fs = require('node:fs');
const integrity = require('../functions/market_integrity');
const model = require('./placard_value');

function auditOpportunity(entry, data) {
  const expectedCount = entry.market === 'h2h' && entry.apiSport.startsWith('soccer_') ? 3 : 2;
  const sameLine = row => row.market === entry.market && (entry.market === 'spreads'
    ? Math.abs(row.line) === Math.abs(entry.line) : row.line === entry.line);
  let rows = [];
  if (entry.sourceReadId) {
    const read = data.reads.find(row => row.id === entry.sourceReadId);
    rows = (read?.validations || []).filter(row => row.sourceEventId === entry.sourceEventId
      && row.pinnacleEventId === entry.eventId && sameLine(row)
      && row.observedAt === entry.placardObservedAt && row.pinnacleUpdatedAt === entry.pinnacleUpdatedAt
      && (entry.sourceMarketIndex === undefined || row.sourceMarketIndex === entry.sourceMarketIndex));
  } else {
    for (const read of data.placardReads || []) {
      const events = typeof read.pinnacle === 'string' ? JSON.parse(read.pinnacle) : read.pinnacle || [];
      const event = events.find(event => event.id === entry.eventId);
      if (!event) continue;
      for (const game of read.games || []) {
        if (game.apiSport !== entry.apiSport || game.observedAt !== entry.placardObservedAt) continue;
        const selections = model.placardSelections(game, event);
        const target = selections.find(row => sameLine(row) && row.selection === entry.selection
          && row.placardOdds === entry.placardOdds);
        if (!target) continue;
        const refs = model.references(event, Date.parse(entry.comparedAt));
        const found = selections.filter(row => row.sourceMarketIndex === target.sourceMarketIndex && sameLine(row))
          .map(row => ({ ...row, ...refs.find(ref => ref.market === row.market && ref.selection === row.selection && ref.line === row.line) }));
        if (found.some(row => row.selection === entry.selection && row.probability === entry.probability
          && row.pinnacleUpdatedAt === entry.pinnacleUpdatedAt)) rows = found;
      }
    }
  }
  const assessment = integrity.assessMarket(rows, expectedCount);
  const identityError = integrity.identityFailure({ sourceEventId: entry.sourceEventId,
    teams: entry.game.split(' x ') }, entry.bookmaker || 'Placard');
  if (identityError) Object.assign(assessment, { approved: false, reason: integrity.REASON, detail: identityError });
  return { id: entry.id, game: entry.game, bookmaker: entry.bookmaker || 'Placard', market: entry.market,
    line: entry.line, selection: entry.selection, sourceOdds: entry.sourceOdds ?? entry.placardOdds,
    originalClosingStatus: entry.closingStatus || null,
    previouslySent: Boolean(entry.telegramMessageId), annulled: integrity.isAnnulled(entry) || !assessment.approved,
    ...assessment };
}

function auditAll(data) { return data.opportunities.map(entry => auditOpportunity(entry, data)); }

async function applyAudit(db, audit) {
  const before = await db.collection('_placard_opportunities').get();
  const auditedIds = new Set(audit.map(row => row.id));
  if (before.docs.some(doc => !auditedIds.has(doc.id)) || before.size !== audit.length)
    throw new Error('Indicações mudaram desde a leitura: atualizar os dados salvos antes de aplicar a auditoria.');
  const auditedAt = new Date().toISOString();
  for (const row of audit) {
    const update = { marketIntegrityAudit: { ...row, auditedAt } };
    if (row.annulled) Object.assign(update, { annulled: true, status: 'anulada',
      closingStatus: 'anulada', annulledAt: auditedAt,
      annulmentReason: row.reason || integrity.REASON, annulmentDetail: row.detail });
    await db.collection('_placard_opportunities').doc(row.id).set(update, { merge: true });
  }
  const entries = (await db.collection('_placard_opportunities').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const bets = (await db.collection('bets').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const report = model.report(entries);
  const betReport = model.betClvReport(entries, bets);
  const manifest = db.collection('results').doc('placard_current');
  const current = (await manifest.get()).data() || {};
  await manifest.set({ report, betReport, integrityAuditedAt: auditedAt }, { merge: true });
  if (current.runId) {
    const run = manifest.collection('runs').doc(current.runId);
    await run.set({ report, betReport, integrityAuditedAt: auditedAt }, { merge: true });
    for (let i = 0; i < (current.pageCount || 0); i++) {
      const ref = run.collection('pages').doc(String(i));
      const page = (await ref.get()).data();
      if (!page) continue;
      const annulledIds = new Set(entries.filter(integrity.isAnnulled).map(row => row.id));
      await ref.set({ ...page, rows: (page.rows || []).filter(row => !annulledIds.has(row.id)) });
    }
  }
  return { auditedAt, report, betReportTotal: betReport.total,
    audited: audit.length, annulled: audit.filter(row => row.annulled).length };
}
module.exports = { auditOpportunity, auditAll, applyAudit };
if (require.main === module) {
  const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const audit = auditAll(data);
  fs.writeFileSync(process.argv[3], JSON.stringify(audit, null, 2) + '\n');
  if (process.argv.includes('--apply')) {
    require('./odds_api_client').loadEnvFileIfPresent();
    applyAudit(require('./local_betano_reader').database(), audit)
      .then(result => { console.log(JSON.stringify(result)); process.exit(); })
      .catch(error => { console.error(error.message); process.exit(1); });
  } else console.log(JSON.stringify(audit));
}
