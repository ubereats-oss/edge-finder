const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const integrity = require('../functions/market_integrity');
const { calibrate, exactTeams } = require('./calibrate_market_integrity.cjs');
const { auditAll } = require('./audit_market_integrity.cjs');
const pipeline = require('./placard_value');
const cloud = require('../functions/placard_value');
const { listingIdentities, verifyPageIdentity } = require('../scripts/local_bookmakers/retabet_identity.cjs');
const { parseRetabetEvent } = require('../scripts/local_bookmakers/fast_readers.cjs');
const at = Date.parse('2026-10-24T04:51:30Z');

// Reconstrução explícita do caso confirmado pelo Alex; não é HTML histórico de Lincoln/Cardiff.
function listing(teams = ['Cardiff', 'Birmingham']) {
  return `<li class="jev event__item" data-i="38617849"><a class="event__players" href="/desportos/futebol/inglaterra/inglaterra-championship/cardiff-birmingham/38617849"><ul class="event__players-name"><li><span data-p="1">${teams[0]}</span></li><li><span data-p="2">${teams[1]}</span></li></ul></a></li>`;
}
const url = 'https://www.retabet.pt/desportos/futebol/inglaterra/inglaterra-championship/cardiff-birmingham/38617849';
function page(teams = ['Cardiff', 'Birmingham']) {
  const options = (labels, prices) => labels.map((label, i) => `<li class="jopc"><span class="jqt">${label}</span><span class="jpr">${prices[i]}</span></li>`).join('');
  return `<html><head><title>Aposte no Lincoln City - Burnley com Retabet</title></head><body>
    <div class="breadcrumbs__event-title" data-id="38617849"><h1>${teams.join(' - ')}</h1></div>Hoje 15:00
    <div class="jev module" data-i="38617849">
      <div class="bets__wrapper jbet"><span class="mt">1-X-2</span>${options(['1', 'X', '2'], [2.59, 3.47, 2.26])}</div>
      <div class="bets__wrapper jbet"><span class="mt">Mais/menos golos</span>${options(['+ de 2,5', '- de 2,5'], [1.46, 2.25])}</div>
    </div></body></html>`;
}

test('calibração exige nomes literais, P99,5 nearest-rank e fallback com menos de 200 pares', () => {
  assert.equal(exactTeams(['Porto', 'Benfica'], ['FC Porto', 'Benfica']), false);
  assert.equal(exactTeams(['Porto', 'Benfica'], ['Benfica', 'Porto']), true);
  const data = { pinnacleEvents: [{ id: 'event', home_team: 'A', away_team: 'B' }], reads: [] };
  for (let i = 0; i < 100; i++) data.reads.push({ id: String(i), bookmaker: 'Casa', validations:
    ['A', 'B'].map(selection => ({ selection, teams: ['A', 'B'], pinnacleEventId: 'event',
      market: 'h2h', line: null, sourceMarketIndex: 0, placardOdds: 1.8, probability: 0.5 })) });
  const result = calibrate(data);
  assert.equal(result.types[2].sampleSize, 200);
  assert.ok(Math.abs(result.types[2].limitPct - 10) < 1e-10);
  assert.equal(result.types[3].fallback, true);
  assert.equal(result.types[3].calibratedFrom, 2);
  assert.throws(() => calibrate({ ...data, reads: data.reads.slice(1) }), /200 pares/);
});

test('calibração publicada contém as amostras completas das casas locais e Placard', () => {
  assert.equal(integrity.limits.types[2].sampleSize, 1272);
  assert.equal(integrity.limits.types[3].sampleSize, 804);
  assert.equal(integrity.limits.types[2].limitPct, 30.981629094422793);
  assert.equal(integrity.limits.types[3].limitPct, 30.557606905027967);
  assert.equal(integrity.limits.types[2].fallback, false);
  assert.equal(integrity.limits.types[3].fallback, false);
});

test('mercado inteiro barra indicação mesmo se só a seleção oposta excede o limite', () => {
  const rows = [{ selection: 'Over', placardOdds: 1.35, probability: 0.5 },
    { selection: 'Under', placardOdds: 2.1, probability: 0.5 }];
  const result = integrity.assessMarket(rows, 2);
  assert.equal(result.approved, false);
  assert.equal(result.reason, 'possível jogo trocado');
  assert.ok(result.evidence[1].differencePct > 0 && result.evidence[1].differencePct < result.limitPct);
  assert.equal(integrity.assessMarket(rows.slice(1), 2).approved, false);
});

test('filtro de mercado atua nos dois módulos e em todas as casas', () => {
  for (const model of [pipeline, cloud]) for (const bookmaker of ['Placard', 'Betano', 'Bwin', 'LeBull', 'ESC Online', 'GoldenPark', 'Retabet', 'Betclic']) {
    const event = { id: 'event', sport_key: 'soccer_efl_champ', home_team: 'A', away_team: 'B',
      commence_time: '2026-10-24T14:00:00Z', bookmakers: [{ key: 'pinnacle', last_update: new Date(at).toISOString(),
        markets: [{ key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.95 }, { name: 'Under', point: 2.5, price: 1.95 }] }] }] };
    const game = { teams: ['A', 'B'], apiSport: event.sport_key, competition: 'Championship',
      commenceTime: event.commence_time, observedAt: new Date(at).toISOString(),
      markets: [{ type: 'HCTG', selections: [{ price: 1.35, line: 2.5 }, { price: 2.1, line: 2.5 }] }] };
    const result = model.compareBookmaker(bookmaker, game, [event], at);
    assert.equal(result.rows.length, 0, bookmaker);
    assert.equal(result.blockedSelections.filter(row => row.reason === integrity.REASON).length, 2);
  }
});

test('caso real Lincoln/Cardiff é barrado pelo filtro por identidade confirmada, sem adulterar P99,5', () => {
  const event = { id: '35338730dd2de8ae05fc62d9d314e05b', sport_key: 'soccer_efl_champ',
    home_team: 'Lincoln City', away_team: 'Burnley', commence_time: '2026-10-24T14:00:00Z',
    bookmakers: [{ key: 'pinnacle', last_update: '2026-10-24T04:52:19Z', markets: [{ key: 'totals',
      outcomes: [{ name: 'Over', point: 2.5, price: 1.92 }, { name: 'Under', point: 2.5, price: 1.97 }] }] }] };
  const game = { apiSport: event.sport_key, competition: 'Championship', teams: ['Lincoln City', 'Burnley'],
    commenceTime: event.commence_time, observedAt: '2026-10-24T04:50:58.819Z', sourceEventId: '38617849', sourceUrl: url,
    markets: [{ type: 'HCTG', selections: [{ price: 1.46, line: 2.5 }, { price: 2.25, line: 2.5 }] }] };
  for (const model of [pipeline, cloud]) {
    const result = model.compareBookmaker('Retabet', game, [event], Date.parse('2026-10-24T04:52:55Z'));
    assert.equal(result.rows.length, 0);
    assert.ok(result.marketIntegrity.every(row => row.detail === 'troca de jogo confirmada na fonte histórica'));
    assert.ok(result.marketIntegrity.every(row => row.evidence.every(side => Math.abs(side.differencePct) < row.limitPct)));
  }
});

test('Retabet usa nomes do corpo, confere a listagem e rejeita Lincoln/Cardiff e ID divergente', t => {
  t.mock.timers.enable({ apis: ['Date'], now: at });
  const identity = listingIdentities(listing(), url).get(url);
  assert.deepEqual(identity.teams, ['Cardiff', 'Birmingham']);
  const game = parseRetabetEvent(page(), url, identity);
  assert.deepEqual(game.teams, ['Cardiff', 'Birmingham']);
  assert.equal(game.sourceIdentityVerified, true);
  assert.deepEqual(game.markets[1].selections.map(row => row.price), [1.46, 2.25]);
  const lincoln = listingIdentities(listing(['Lincoln City', 'Burnley']), url).get(url);
  assert.throws(() => parseRetabetEvent(page(), url, lincoln), /divergem da listagem/);
  assert.equal(verifyPageIdentity(page().replace('data-id="38617849"', 'data-id="38617851"'), url, identity).verified, false);
  assert.throws(() => parseRetabetEvent(page(), url), /listagem.*ausente/);
});

test('notificador da Retabet exige aceite e prova de identidade; anulada nunca envia', () => {
  const marketIntegrity = integrity.assessMarket([{ selection: 'Over', placardOdds: 1.9, probability: 0.5 },
    { selection: 'Under', placardOdds: 2.1, probability: 0.5 }], 2);
  assert.equal(integrity.notificationAllowed({ bookmaker: 'Retabet', marketIntegrity, sourceIdentityVerified: true }, { passed: false }), false);
  assert.equal(integrity.notificationAllowed({ bookmaker: 'Retabet', marketIntegrity }, { passed: true }), false);
  assert.equal(integrity.notificationAllowed({ bookmaker: 'Retabet', marketIntegrity, placardOdds: 2.1, probability: 0.5,
    sourceIdentityVerified: true }, { passed: true }), true);
  assert.equal(integrity.notificationAllowed({ bookmaker: 'Bwin' }), false);
  assert.equal(integrity.notificationAllowed({ bookmaker: 'Bwin', marketIntegrity, placardOdds: 2.1, probability: 0.5 }), true);
  assert.equal(integrity.notificationAllowed({ bookmaker: 'Bwin', annulled: true }), false);
});

test('teto positivo usa nomes exatos, fallback máximo + 2pp e não ativa se Lincoln passar', () => {
  const { calibratePositiveEdge } = require('./calibrate_positive_edge.cjs');
  const entry = { game: 'Lincoln City x Burnley', selection: 'Under', placardOdds: 2.25, probability: 0.4933022141653564 };
  const data = { capturedAt: '2026-10-24', pinnacleEvents: [{ id: 'event', home_team: 'A', away_team: 'B' }],
    opportunities: [entry], reads: [{ id: 'read', bookmaker: 'Casa', validations: [
      { teams: ['A', 'B'], pinnacleEventId: 'event', selection: 'A', placardOdds: 2.08, probability: 0.5 },
      { teams: ['FC A', 'B'], pinnacleEventId: 'event', selection: 'A', placardOdds: 10, probability: 0.5 },
      { teams: ['A', 'B'], pinnacleEventId: 'event', selection: 'B', placardOdds: 1.9, probability: 0.5 },
    ] }] };
  const calibrated = calibratePositiveEdge(data);
  assert.equal(calibrated.sampleSize, 1);
  assert.ok(Math.abs(calibrated.ceilingPct - 6) < 1e-10);
  assert.equal(calibrated.fallback, true);
  assert.equal(calibrated.enabled, true);
  const high = calibratePositiveEdge({ ...data, reads: Array.from({ length: 200 }, (_, i) => ({ id: String(i),
    validations: [{ teams: ['A', 'B'], pinnacleEventId: 'event', selection: 'A', placardOdds: 2.4, probability: 0.5 }] })) });
  assert.equal(high.fallback, false);
  assert.equal(high.enabled, false);
  assert.equal(integrity.assessPositiveEdge(2.25, entry.probability, high).approved, true);
});

test('teto publicado tem três vantagens positivas, barra Lincoln sem veto de identidade e aceita o limite', () => {
  const policy = integrity.positiveEdgeLimits;
  assert.equal(policy.sampleSize, 3);
  assert.equal(policy.eligiblePairs, 2076);
  assert.equal(policy.fallback, true);
  assert.equal(policy.enabled, true);
  assert.equal(policy.ceilingPct, 5.890199518677773);
  assert.equal(integrity.assessPositiveEdge(2.25, 0.4933022141653564).approved, false);
  assert.equal(integrity.assessPositiveEdge(2, 0.5, { enabled: true, ceilingPct: 0 }).approved, true);
  for (const model of [pipeline, cloud]) {
    const event = { id: 'lincoln-test', sport_key: 'soccer_efl_champ', home_team: 'Lincoln City', away_team: 'Burnley',
      commence_time: '2026-10-24T14:00:00Z', bookmakers: [{ key: 'pinnacle', last_update: '2026-10-24T04:52:19Z',
        markets: [{ key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.92 }, { name: 'Under', point: 2.5, price: 1.97 }] }] }] };
    const game = { apiSport: event.sport_key, teams: ['Lincoln City', 'Burnley'], competition: 'Championship',
      commenceTime: event.commence_time, observedAt: '2026-10-24T04:50:58.819Z', sourceEventId: 'not-confirmed-invalid',
      markets: [{ type: 'HCTG', selections: [{ price: 1.46, line: 2.5 }, { price: 2.25, line: 2.5 }] }] };
    const result = model.compareBookmaker('Bwin', game, [event], Date.parse('2026-10-24T04:52:55Z'));
    assert.equal(result.rows.length, 0);
    assert.ok(result.marketIntegrity.every(row => row.approved));
    assert.ok(result.blockedSelections.some(row => row.selection === 'Under' && row.reason === integrity.EDGE_REASON));
  }
});

for (const house of ['esc_online', 'goldenpark', 'betclic']) test(`${house}: página real correta aceita; jogo trocado, invertido e title falso não passam`, () => {
  const { verifyIdentity, requireIdentity } = require('../scripts/local_bookmakers/page_identity.cjs');
  const saved = require('../scripts/local_bookmakers/fixtures/page_identity_saved.cjs')[house];
  assert.equal(verifyIdentity(house, saved.pageHeader, saved.listingTeams).verified, true);
  const swapped = saved.pageHeader.replaceAll('Lech Poznan', 'Cardiff').replaceAll('Sunderland', 'Birmingham');
  assert.throws(() => requireIdentity(house, `<title>Lech Poznan - Sunderland</title>${swapped}`, saved.listingTeams), /divergem/);
  assert.equal(verifyIdentity(house, saved.pageHeader, [...saved.listingTeams].reverse()).verified, false);
  assert.equal(verifyIdentity(house, '<title>Lech Poznan - Sunderland</title>', saved.listingTeams).verified, false);
});

test('leitores ESC/GoldenPark/Betclic aceitam o evento preservado e descartam outro jogo antes de ler odds', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-22T14:00:00Z') });
  const saved = require('../scripts/local_bookmakers/fixtures/page_identity_saved.cjs');
  const { parseEscEvent, parseBetclicEvent } = require('../scripts/local_bookmakers/fast_readers.cjs');
  const { parseEvent } = require('../scripts/local_bookmakers/goldenpark_reader.cjs');
  const listing = { teams: ['Lech Poznan', 'Sunderland'], apiSport: 'soccer_uefa_europa_league', competition: 'Liga Europa',
    commenceTime: '2026-10-22T16:45:00Z', href: 'https://www.betclic.pt/lech-sunderland-m123', label: 'Lech Poznan - Sunderland' };
  for (const house of ['esc_online', 'goldenpark', 'betclic']) {
    const source = saved[house].pageHeader + ' Hoje 13:45 ' + saved[house].markets;
    const parse = html => house === 'esc_online' ? parseEscEvent(html, 'https://www.estorilsolcasinos.pt/event-123',
      'Lech Poznan\nSunderland', listing) : house === 'goldenpark' ? parseEvent(html, listing, 'https://apostas.goldenpark.pt/evento/123', '123')
        : parseBetclicEvent(html, listing);
    const game = parse(source);
    assert.ok(game, house);
    assert.equal(game.sourceIdentityVerified, true);
    assert.deepEqual(game.teams, listing.teams);
    const wrong = source.replaceAll('Lech Poznan', 'Cardiff').replaceAll('Sunderland', 'Birmingham');
    if (house === 'goldenpark') assert.throws(() => parse(wrong), /divergem/);
    else assert.equal(parse(wrong), null);
  }
});

test('LeBull não confunde listagem com página de jogo; envio permanece fechado sem aceite', () => {
  const { verifyIdentity } = require('../scripts/local_bookmakers/page_identity.cjs');
  const saved = require('../scripts/local_bookmakers/fixtures/page_identity_saved.cjs').lebull;
  assert.equal(verifyIdentity('lebull', saved.pageHeader, saved.listingTeams).verified, false);
  // Estrutura simulada de página individual: prova da regra, não aceite de página real LeBull.
  const page = '<div><span class="team-column-name">A</span><span class="team-column-name">B</span></div>';
  assert.equal(verifyIdentity('lebull', page, ['A', 'B']).verified, true);
  assert.equal(verifyIdentity('lebull', page, ['Cardiff', 'Birmingham']).verified, false);
  const assessment = integrity.assessMarket([{ selection: 'A', placardOdds: 2.1, probability: 0.5 },
    { selection: 'B', placardOdds: 1.9, probability: 0.5 }], 2);
  for (const bookmaker of ['LeBull', 'ESC Online', 'GoldenPark', 'Betclic']) {
    const row = { bookmaker, marketIntegrity: assessment, placardOdds: 2.1, probability: 0.5 };
    assert.equal(integrity.notificationAllowed(row, { passed: true }), false);
    assert.equal(integrity.notificationAllowed({ ...row, sourceIdentityVerified: true }, { passed: false }), false);
    assert.equal(integrity.notificationAllowed({ ...row, sourceIdentityVerified: true }, { passed: true }), true);
    assert.equal(integrity.notificationAllowed({ ...row, placardOdds: 2.25, sourceIdentityVerified: true }, { passed: true }), false);
  }
});

test('auditoria do teto preserva aprovadas e exclui suspeita do desempenho e veredito', () => {
  const { auditPositiveEdges } = require('./audit_positive_edge.cjs');
  const entries = [{ id: 'ok', game: 'A x B', placardOdds: 2.08, probability: 0.5, eventId: 'ok', clvPct: -1 },
    { id: 'bad', game: 'C x D', placardOdds: 2.25, probability: 0.5, eventId: 'bad', clvPct: 100 }];
  const audit = auditPositiveEdges(entries);
  assert.equal(audit[0].annulled, false);
  assert.equal(audit[1].annulled, true);
  assert.equal(audit[1].reason, integrity.EDGE_REASON);
  for (const model of [pipeline, cloud]) {
    const report = model.report(entries.map(row => ({ ...row, annulled: audit.find(a => a.id === row.id).annulled })));
    assert.equal(report.total, 1);
    assert.equal(report.mean, -1);
    assert.equal(report.verdict, 'não confirmado');
  }
});

test('auditoria publicada cobre as quatro indicações mantidas sem novas anulações', () => {
  const audit = require('./positive_edge_audit_2026-10-24.json');
  assert.equal(audit.length, 4);
  assert.equal(audit.filter(row => row.annulled).length, 0);
  assert.ok(audit.every(row => row.edgePct <= integrity.positiveEdgeLimits.ceilingPct));
  assert.deepEqual(audit.map(row => row.houseOdds), [1.92, 3.35, 7.1, 2.6]);
  assert.ok(!audit.some(row => row.game === 'Lincoln City x Burnley'));
});

test('comparação rejeita leitura antiga sem identidade das quatro casas mesmo abaixo do teto', () => {
  const event = { id: 'identity-proof', sport_key: 'basketball_nba', home_team: 'A', away_team: 'B',
    commence_time: '2026-10-24T14:00:00Z', bookmakers: [{ key: 'pinnacle', last_update: new Date(at).toISOString(),
      markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: 2 }, { name: 'B', price: 2 }] }] }] };
  const game = { apiSport: event.sport_key, teams: ['A', 'B'], competition: 'NBA',
    observedAt: new Date(at).toISOString(), commenceTime: event.commence_time,
    markets: [{ type: 'H2HT', selections: [{ price: 2.08, line: null }, { price: 1.9, line: null }] }] };
  for (const model of [pipeline, cloud]) for (const bookmaker of ['LeBull', 'ESC Online', 'GoldenPark', 'Betclic']) {
    const rejected = model.compareBookmaker(bookmaker, game, [event], at);
    assert.equal(rejected.rows.length, 0, bookmaker);
    assert.ok(rejected.marketIntegrity.every(row => row.detail === 'identidade da página do jogo não comprovada'));
    assert.equal(model.compareBookmaker(bookmaker, { ...game, sourceIdentityVerified: true }, [event], at).rows.length, 1, bookmaker);
  }
});

test('identidade Retabet aceita os nomes e o ID do HTML real preservado de GD Chaves–FC Vizela', () => {
  const saved = require('../scripts/local_bookmakers/fixtures/retabet_saved_identity.json');
  const identity = listingIdentities(saved.listing, saved.url).get(saved.url);
  const result = verifyPageIdentity(saved.pageHeader, saved.url, identity);
  assert.equal(result.verified, true);
  assert.deepEqual(result.teams, ['GD Chaves', 'FC Vizela']);
});

test('mercado de três resultados exige todos os lados dentro do limite', () => {
  const rows = [{ selection: 'A', placardOdds: 3.2, probability: 1 / 3 },
    { selection: 'Draw', placardOdds: 2.9, probability: 1 / 3 },
    { selection: 'B', placardOdds: 1.8, probability: 1 / 3 }];
  assert.equal(integrity.assessMarket(rows, 3).approved, false);
  rows[2].placardOdds = 2.9;
  assert.equal(integrity.assessMarket(rows, 3).approved, true);
});

test('anuladas não contam no desempenho, apostas vinculadas nem veredito dos dois módulos', () => {
  const valid = { id: 'valid', apiSport: 'nba', eventId: 'valid', clvPct: -1, closingStatus: 'capturada',
    sourceOdds: 2, closingFairOdds: 2.1 };
  const voids = Array.from({ length: 100 }, (_, i) => ({ id: 'void' + i, apiSport: 'nba', eventId: String(i),
    clvPct: 20, closingStatus: 'capturada', annulled: true }));
  for (const model of [pipeline, cloud]) {
    const report = model.report([valid, ...voids]);
    assert.equal(report.total, 1);
    assert.equal(report.n, 1);
    assert.equal(report.mean, -1);
    assert.equal(report.verdict, 'não confirmado');
  }
  assert.equal(pipeline.betClvReport([valid, ...voids],
    [{ id: 'a', indicationId: 'valid', odds: 2 }, { id: 'b', indicationId: 'void0', odds: 2 }]).total, 1);
});

test('lista da auditoria preserva todas as cinco indicações e odds de cada lado', () => {
  const audit = require('./market_integrity_audit_2026-10-24.json');
  assert.equal(audit.length, 5);
  assert.equal(audit.filter(row => row.annulled).length, 1);
  const lincoln = audit.find(row => row.game === 'Lincoln City x Burnley');
  assert.equal(lincoln.annulled, true);
  assert.deepEqual(lincoln.evidence.map(row => [row.houseOdds, row.pinnacleOdds]), [[1.46, 1.92], [2.25, 1.97]]);
});
