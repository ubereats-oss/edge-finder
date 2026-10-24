const limits = require('./market_integrity_limits.json');
const positiveEdgeLimits = require('./positive_edge_limits.json');
const REASON = 'possível jogo trocado';
const EDGE_REASON = 'suspeita de erro de dado';
const IDENTITY_GATES = { retabet: 'retabet_identity', lebull: 'lebull_identity',
  'esc online': 'esc_online_identity', goldenpark: 'goldenpark_identity', betclic: 'betclic_identity' };
function identityGate(bookmaker) { return IDENTITY_GATES[String(bookmaker || '').toLowerCase()] || null; }
function assessPositiveEdge(odds, probability, policy = positiveEdgeLimits) {
  const edgePct = 100 * (Number(odds) * Number(probability) - 1);
  const valid = Number(odds) > 1 && Number(probability) > 0 && Number(probability) < 1;
  const approved = !policy.enabled || (valid && Number.isFinite(policy.ceilingPct) && edgePct <= policy.ceilingPct);
  return { approved, reason: approved ? null : EDGE_REASON, edgePct: valid ? edgePct : null,
    ceilingPct: policy.ceilingPct, enabled: policy.enabled, version: policy.version };
}
function exactTeams(a, b) {
  return a?.length === 2 && b?.length === 2 &&
    ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]));
}
function identityFailure(game, bookmaker, policy = limits) {
  if (game.sourceIdentityVerified === false) return game.identityReason || 'identidade da página do jogo não comprovada';
  if (game.listingTeams && !exactTeams(game.teams, game.listingTeams))
    return 'nomes da página divergem da listagem';
  if (policy.confirmedInvalidSources.some(bad => bad.bookmaker.toLowerCase() === String(bookmaker).toLowerCase()
    && bad.sourceEventId === game.sourceEventId && exactTeams(bad.teams, game.teams)))
    return 'troca de jogo confirmada na fonte histórica';
  return null;
}
function assessMarket(rows, expectedCount, policy = limits) {
  const type = Number(expectedCount);
  const limitPct = policy.types[type]?.limitPct;
  const evidence = rows.map(row => ({ selection: row.selection, line: row.line ?? null,
    houseOdds: Number(row.placardOdds ?? row.sourceOdds), pinnacleOdds: row.pinnacleOdds ?? null,
    fairOdds: row.probability > 0 ? 1 / row.probability : null,
    differencePct: row.probability > 0 ? 100 * (Number(row.placardOdds ?? row.sourceOdds) * row.probability - 1) : null }));
  const complete = [2, 3].includes(type) && rows.length === type &&
    new Set(rows.map(row => row.selection)).size === type &&
    rows.every(row => Number(row.placardOdds ?? row.sourceOdds) > 1 && row.probability > 0 && row.probability < 1)
    && Math.abs(rows.reduce((sum, row) => sum + row.probability, 0) - 1) < 1e-8;
  const approved = complete && Number.isFinite(limitPct) && evidence.every(row => Math.abs(row.differencePct) <= limitPct);
  return { approved, reason: approved ? null : REASON,
    detail: !complete ? 'evidência do mercado inteiro incompleta' : !approved ? 'diferença acima do limite calibrado' : null,
    type, limitPct: limitPct ?? null, version: policy.version, evidence };
}
function assessGame(game, event, selections, refs, bookmaker = 'Placard', policy = limits) {
  const groups = new Map();
  for (const selection of selections) {
    const line = selection.market === 'spreads' && selection.selection === event.away_team ? -selection.line : selection.line;
    const key = `${selection.sourceMarketIndex}|${line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(selection);
  }
  const results = new Map();
  const identityError = identityFailure(game, bookmaker, policy);
  for (const rows of groups.values()) {
    const resolved = rows.map(selection => {
      const ref = refs.find(row => row.market === selection.market && row.line === selection.line && row.selection === selection.selection);
      return { ...selection, probability: ref?.probability, pinnacleOdds: ref?.pinnacleOdds };
    });
    const count = game.markets[rows[0].sourceMarketIndex]?.selections?.length;
    const result = assessMarket(resolved, count, policy);
    if (identityError) Object.assign(result, { approved: false, reason: REASON, detail: identityError });
    for (const selection of rows) results.set(`${selection.sourceMarketIndex}:${selection.sourceSelectionIndex}`, result);
  }
  return results;
}
function isAnnulled(row) { return row.annulled === true || row.status === 'anulada'; }
function notificationAllowed(row, gate) {
  const assessment = row.marketIntegrity || row.marketIntegrityAudit;
  if (isAnnulled(row) || assessment?.approved !== true || assessment.version !== limits.version) return false;
  if (!assessPositiveEdge(row.sourceOdds ?? row.placardOdds, row.probability).approved) return false;
  const checked = assessMarket((assessment.evidence || []).map(side => ({ selection: side.selection,
    placardOdds: side.houseOdds, probability: side.fairOdds > 0 ? 1 / side.fairOdds : null })), assessment.type);
  return checked.approved && (!identityGate(row.bookmaker)
    || (gate?.passed === true && row.sourceIdentityVerified === true));
}
module.exports = { limits, positiveEdgeLimits, REASON, EDGE_REASON, identityGate, assessPositiveEdge,
  exactTeams, identityFailure, assessMarket, assessGame, isAnnulled, notificationAllowed };
