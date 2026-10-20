const crypto = require('crypto');
const aliases = require('./placard_aliases.json');
const { KELLY_FRACTION } = require('./risk_config');
const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizedAliases = new Map(Object.entries(aliases).map(([name, values]) => [normalize(name), values]));
function namesEqual(placard, canonical) {
  return [placard, ...(normalizedAliases.get(normalize(placard)) || [])].some(n => normalize(n) === normalize(canonical));
}
function fairProbabilities(prices) {
  if (prices.length < 2 || prices.some(p => !Number.isFinite(p) || p <= 1)) return null;
  let lo = 0, hi = 64;
  for (let i = 0; i < 100; i++) {
    const k = (lo + hi) / 2;
    if (prices.reduce((s, p) => s + (1 / p) ** k, 0) > 1) lo = k; else hi = k;
  }
  const p = prices.map(o => (1 / o) ** ((lo + hi) / 2));
  const sum = p.reduce((s, v) => s + v, 0);
  return p.map(v => v / sum);
}
function references(event, now = Date.now(), historical = false) {
  const bm = event.bookmakers?.find(b => b.key === 'pinnacle');
  const rows = [];
  for (const market of bm?.markets || []) {
    const update = market.last_update || bm.last_update;
    const age = now - Date.parse(update);
    if (!Number.isFinite(age) || age < 0 || age > (historical ? 300000 : 120000)) continue;
    if (market.key === 'h2h') {
      const names = [event.home_team, ...(event.sport_key?.startsWith('soccer_') ? ['Draw'] : []), event.away_team];
      const outcomes = names.map(name => market.outcomes?.find(o => o.name === name));
      if (outcomes.some(o => !o) || market.outcomes.length !== names.length) continue;
      const probs = fairProbabilities(outcomes.map(o => o.price));
      if (probs) outcomes.forEach((o, i) => rows.push({ market: 'h2h', line: null, selection: o.name, probability: probs[i], pinnacleOdds: o.price, pinnacleUpdatedAt: update }));
    }
    if (market.key === 'totals') {
      for (const line of new Set(market.outcomes?.map(o => o.point))) {
        // Em linhas inteiras, as probabilidades são condicionais a não haver
        // devolução. O Kelly ótimo é o mesmo: a parcela push soma log(1)=0.
        // Linhas de quarto têm meia vitória/derrota e exigem outro contrato.
        if (!Number.isFinite(line) || line < 0 || !Number.isInteger(line * 2)) continue;
        const outcomes = ['Over', 'Under'].map(name => market.outcomes.find(o => o.name === name && o.point === line));
        if (outcomes.some(o => !o)) continue;
        const probs = fairProbabilities(outcomes.map(o => o.price));
        if (probs) outcomes.forEach((o, i) => rows.push({ market: 'totals', line, selection: o.name, probability: probs[i], probabilityBasis: Number.isInteger(line) ? 'condicional_sem_devolucao' : 'binaria', pinnacleOdds: o.price, pinnacleUpdatedAt: update }));
      }
    }
  }
  return rows;
}
function placardSelections(game, event) {
  const teamNames = game.teams.map(t => [event.home_team, event.away_team].filter(n => namesEqual(t, n)));
  if (teamNames.some(a => a.length !== 1) || teamNames[0][0] === teamNames[1][0]) return [];
  const rows = [];
  for (const m of game.markets) {
    let selections;
    if (m.type === 'MRES') selections = [teamNames[0][0], 'Draw', teamNames[1][0]];
    else if (m.type === 'H2HT') selections = [teamNames[0][0], teamNames[1][0]];
    else if (m.type === 'TPOT' || m.type === 'HCTG') selections = ['Over', 'Under'];
    else continue;
    if (m.selections.length !== selections.length) continue;
    for (let i = 0; i < selections.length; i++) {
      const s = m.selections[i];
      const price = Number(s.price), line = s.line === null ? null : Number(s.line);
      if (s.unavailable || !Number.isFinite(price) || price <= 1) continue;
      rows.push({ market: ['TPOT', 'HCTG'].includes(m.type) ? 'totals' : 'h2h',
        selection: selections[i], line, placardOdds: price });
    }
  }
  return rows;
}
function compare(game, events, now = Date.now()) {
  if (!game.commenceTime || now >= Date.parse(game.commenceTime) || Date.parse(game.commenceTime) > now + 12 * 3600000) return { rows: [], reason: 'fora_janela_12h' };
  const age = now - Date.parse(game.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 120000) return { rows: [], reason: 'placard_antigo' };
  const matches = events.filter(e => Math.abs(Date.parse(e.commence_time) - Date.parse(game.commenceTime)) <= 60000
    && game.teams.every(t => namesEqual(t, e.home_team) || namesEqual(t, e.away_team)));
  if (matches.length !== 1) return { rows: [], reason: matches.length ? 'evento_ambiguo' : 'evento_sem_correspondencia' };
  const event = matches[0];
  const refs = references(event, now);
  const rows = [];
  let comparedSelections = 0;
  for (const s of placardSelections(game, event)) {
    const ref = refs.find(r => r.market === s.market && r.line === s.line && r.selection === s.selection);
    if (!ref) continue;
    comparedSelections++;
    if (s.placardOdds <= 1.01 / ref.probability) continue;
    const edgePct = (s.placardOdds * ref.probability - 1) * 100;
    const id = crypto.createHash('sha256').update(JSON.stringify([game.apiSport, event.id, s.market, s.line, s.selection])).digest('hex');
    rows.push({ ...s, ...ref, id, apiSport: game.apiSport, eventId: event.id,
      game: `${event.home_team} x ${event.away_team}`, competition: game.competition,
      commenceTime: event.commence_time, placardObservedAt: game.observedAt,
      comparedAt: new Date(now).toISOString(), sourceUrl: game.sourceUrl,
      minValueOdds: 1.01 / ref.probability, edgePct,
      kellyPct: Math.max(0, edgePct / (s.placardOdds - 1) * KELLY_FRACTION) });
  }
  return { rows, comparedSelections, reason: rows.length ? null : comparedSelections ? 'sem_valor' : 'sem_linha_equivalente_ou_preco_recente' };
}
function report(entries) {
  const closed = entries.filter(e => Number.isFinite(e.clvPct));
  const groups = new Map();
  for (const e of closed) {
    const key = `${e.apiSport}|${e.eventId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.clvPct);
  }
  const mean = closed.length ? closed.reduce((s, e) => s + e.clvPct, 0) / closed.length : null;
  let lower = null, upper = null;
  // Bootstrap por evento preserva a correlação entre lados/mercados do jogo.
  if (groups.size >= 2) {
    let seed = 1729;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const clusters = [...groups.values()], means = [];
    for (let i = 0; i < 4000; i++) {
      let sum = 0, count = 0;
      for (let j = 0; j < clusters.length; j++) {
        const values = clusters[Math.floor(random() * clusters.length)];
        for (const v of values) { sum += v; count++; }
      }
      means.push(sum / count);
    }
    means.sort((a, b) => a - b);
    lower = means[100]; upper = means[3899];
  }
  return { n: closed.length, nEvents: groups.size, total: entries.length,
    pending: entries.filter(e => !e.closingStatus || e.closingStatus === 'pendente').length,
    missing: entries.filter(e => e.closingStatus === 'indisponivel').length,
    mean, lower, upper, verdict: closed.length >= 100 && lower !== null && lower > 0 ? 'confirmado' : 'não confirmado',
    ciMethod: 'bootstrap por evento, 4000 reamostragens; uma amostra por evento/mercado/linha/lado' };
}
module.exports = { namesEqual, normalize, fairProbabilities, references, compare, report };
