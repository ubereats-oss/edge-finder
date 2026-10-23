const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');
const { database, summarize: summarizeBudget, CLOSING_RESERVE } = require('./odds_api_monthly_budget');
const { createBrowser, scrapeCompetition } = require('./get_placard_odds');
const { compare, compareBookmaker, references, matchingEvents, isNearValue, nearValueSelections, report, namesEqual, normalize,
  comparedSelectionCount, placardSelections } = require('./placard_value');
const competitions = require('./placard_config');
const fs = require('fs');
const crypto = require('crypto');

async function allEntries(db) {
  const rows = [];
  let cursor;
  for (;;) {
    let query = db.collection('_placard_opportunities').orderBy('__name__').limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    rows.push(...snap.docs.map(d => ({ ...d.data(), id: d.id })));
    if (snap.size < 500) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function forEachCompetitionIsolated(items, worker, onError) {
  for (const item of items) {
    try { await worker(item); }
    catch (error) { await onError(item, error); }
  }
}

function pinnacleRefreshDue(deltaMs, lastFetchedAt, lastProbeAt, now = Date.now()) {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return false;
  if (deltaMs <= 2 * 3600000) return true;
  if (deltaMs > 6 * 3600000) return false;
  const last = Date.parse(lastFetchedAt || lastProbeAt || '');
  return !Number.isFinite(last) || now - last >= 60 * 60000;
}

async function saveOpportunity(db, row) {
  const ref = db.collection('_placard_opportunities').doc(row.id);
  await db.runTransaction(async tx => {
    const previous = await tx.get(ref);
    if (!previous.exists) tx.create(ref, { ...row, closingStatus: 'pendente' });
    else tx.update(ref, { lastObservedAt: row.placardObservedAt, lastPlacardOdds: row.placardOdds });
  });
}

async function exactTotals(api, sport, event, lines, attempted, closing = false) {
  const available = references(event, Date.now(), closing).filter(r => r.market === 'totals').map(r => r.line);
  const missing = lines.filter(line => Number.isFinite(line) && Number.isInteger(line * 2) && !available.includes(line));
  if (!missing.length || attempted.has(event.id)) return;
  attempted.add(event.id);
  // Nunca converte, por exemplo, Pinnacle 3,25 em Placard 3,5. Busca a linha
  // exata entre os totais alternativos quando o fornecedor a disponibiliza.
  const { data } = await api.get(`https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds`, {
    timeout: 15000, params: { bookmakers: 'pinnacle', markets: 'alternate_totals', oddsFormat: 'decimal' },
  });
  const alternate = data?.bookmakers?.find(b => b.key === 'pinnacle')?.markets?.find(m => m.key === 'alternate_totals');
  if (!alternate || data.id !== event.id || Math.abs(Date.parse(data.commence_time) - Date.parse(event.commence_time)) > 60000) return;
  const bm = event.bookmakers?.find(b => b.key === 'pinnacle');
  if (bm) bm.markets.push(alternate);
  else {
    event.bookmakers ||= [];
    event.bookmakers.push({ key: 'pinnacle', markets: [alternate] });
  }
}

async function exactSpreads(api, sport, event, lines, attempted, closing = false) {
  const available = references(event, Date.now(), closing).filter(r => r.market === 'spreads').map(r => `${r.selection}|${r.line}`);
  const missing = lines.filter(row => Number.isFinite(row.line) && Number.isInteger(row.line * 2)
    && !available.includes(`${row.selection}|${row.line}`));
  if (!missing.length || attempted.has(`spreads:${event.id}`)) return;
  attempted.add(`spreads:${event.id}`);
  const { data } = await api.get(`https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds`, {
    timeout: 15000, params: { bookmakers: 'pinnacle', markets: 'alternate_spreads', oddsFormat: 'decimal' },
  });
  const alternate = data?.bookmakers?.find(b => b.key === 'pinnacle')?.markets?.find(m => m.key === 'alternate_spreads');
  if (!alternate || data.id !== event.id || Math.abs(Date.parse(data.commence_time) - Date.parse(event.commence_time)) > 60000) return;
  const bm = event.bookmakers?.find(b => b.key === 'pinnacle');
  if (bm) bm.markets.push(alternate);
  else { event.bookmakers ||= []; event.bookmakers.push({ key: 'pinnacle', markets: [alternate] }); }
}

function closingStartTolerance(entry, sport) {
  if (sport.startsWith('tennis_')) return 3 * 60 * 60 * 1000;
  if (entry.bookmaker === 'Betano' && entry.sourceScheduleVerified === true) return 10 * 60000;
  return 60000;
}

function tennisCompetitionAlias(key) {
  const slug = key.replace(/^tennis_(?:atp|wta)_/, '').replace(/_singles$/, '');
  const special = { aus_open: 'Melbourne', french_open: 'Paris', us_open: 'New York',
    queens_club_champ: 'London', monte_carlo_masters: 'Monte-Carlo', indian_wells: 'Indian Wells',
    canadian_open: 'Toronto', china_open: 'Beijing', italian_open: 'Roma', japan_open: 'Tokyo',
    wimbledon: 'London', paris_masters: 'Paris', shanghai_masters: 'Shanghai',
    barcelona_open: 'Barcelona', hamburg_open: 'Hamburg', halle_open: 'Halle', munich: 'Munich',
    cincinnati_open: 'Cincinnati', washington_open: 'Washington', dubai: 'Dubai',
    singapore_open: 'Singapore', ningbo_open: 'Ningbo', osaka: 'Osaka', guadalajara_open: 'Guadalajara',
    wuhan_open: 'Wuhan', monterrey_open: 'Monterrey', strasbourg: 'Strasbourg', stuttgart_open: 'Stuttgart' };
  const name = special[slug] || slug.split('_').filter(part => !['open', 'championship', 'champ', 'masters', 'singles', 'wta', 'atp'].includes(part)).join(' ');
  return `${name.replace(/\b\w/g, c => c.toUpperCase())} - Individual`;
}

function competitionUrl(found, cfg) {
  const normalizeText = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const labels = [cfg.label, ...(cfg.aliases || [])].map(normalizeText);
  const urls = rows => [...new Set(rows.map(l => l.href.replace(/\/matches$/, '')))];
  const exact = urls(found.filter(l => labels.includes(normalizeText(l.text))));
  if (exact.length === 1) return `${exact[0]}/matches`;
  if (exact.length > 1) return null;
  if (cfg.sport !== 'tennis') return null;
  const aliases = [tennisCompetitionAlias(cfg.key).replace(/ - Individual$/i, '')];
  if (cfg.key.endsWith('_canadian_open')) aliases.push('Montreal');
  if (cfg.key.endsWith('_aus_open_singles')) aliases.push('Australian Open');
  if (cfg.key.endsWith('_french_open')) aliases.push('Roland Garros');
  const fuzzy = urls(found.filter(l => aliases.some(alias => normalizeText(alias).length > 2
    && normalizeText(l.text).includes(normalizeText(alias)))));
  return fuzzy.length === 1 ? `${fuzzy[0]}/matches` : null;
}

async function readCompetitionLinks(page) {
  const found = new Map();
  for (let i = 0; i < 40; i++) {
    const links = await page.locator('a.ta-SportGroupsListButton').evaluateAll(es => es.map(e => ({
      text: e.textContent.trim().replace(/^soccer icon/, ''), href: e.href,
    })));
    for (const link of links) if (link.href) found.set(link.href, link);
    const moved = await page.evaluate(() => {
      const first = document.querySelector('a.ta-SportGroupsListButton');
      let scroller = first?.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 10
        && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      scroller ||= document.scrollingElement;
      const old = scroller.scrollTop;
      scroller.scrollTop += Math.max(scroller.clientHeight * 0.8, 500);
      return scroller.scrollTop !== old;
    });
    if (!moved) break;
    await page.waitForTimeout(150);
  }
  return [...found.values()];
}

const placardSportPaths = {
  americanfootball: ['american-football', 'americanfootball', 'football'],
  icehockey: ['ice-hockey', 'icehockey', 'hockey'],
  mma: ['mma', 'mixed-martial-arts', 'ufc'],
};

async function scan(db, scanRunId = `${process.env.GITHUB_RUN_ID || 'local'}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`) {
  const rows = [], errors = [], diagnostics = [];
  const api = createOddsApiClient({ label: 'placard-scan' });
  const attemptedAlternates = new Set();
  const browser = await createBrowser();
  try {
    const page = await browser.newPage({ locale: 'pt-PT', timezoneId: 'UTC' });
    // Redescobre IDs, que podem mudar a cada temporada. Nunca usa URL de
    // outra liga como fallback quando o nome deixa de existir.
    let catalogSports;
    try {
      const catalogResponse = await api.get('https://api.the-odds-api.com/v4/sports', { timeout: 15000, params: { all: 'true' } });
      catalogSports = catalogResponse.data;
    } catch (error) {
      errors.push({ competition: 'catálogo The Odds API', error: error.message });
      catalogSports = competitions.map(c => ({ key: c.key, title: c.label, active: true }));
    }
    const activeKeys = new Set(catalogSports.filter(s => s.active).map(s => s.key));
    const activeCompetitions = competitions.filter(c => activeKeys.has(c.key));
    for (const sport of catalogSports.filter(s => s.active && /^tennis_(?:atp|wta)_/.test(s.key))) {
      if (!activeCompetitions.some(c => c.key === sport.key)) activeCompetitions.push({
        key: sport.key, label: sport.title || tennisCompetitionAlias(sport.key), sport: 'tennis', markets: ['h2h', 'spreads', 'totals'],
      });
    }
    const links = new Map();
    const sportCatalogs = new Map();
    for (const sport of new Set(activeCompetitions.map(c => c.sport))) {
      try {
        let found = [];
        for (const path of placardSportPaths[sport] || [sport]) {
          try {
            await page.goto(`https://www.placard.pt/apostas/sports/${path}/competitions`, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.locator('a.ta-SportGroupsListButton').first().waitFor({ state: 'attached', timeout: 8000 });
            found = await readCompetitionLinks(page);
            if (found.length) break;
          } catch (_) { /* tenta o próximo slug observado/canônico */ }
        }
        if (!found.length) throw new Error(`Nenhum slug Placard respondeu para ${sport}.`);
        sportCatalogs.set(sport, found.map(l => l.text));
        for (const cfg of activeCompetitions.filter(c => c.sport === sport)) {
          const url = competitionUrl(found, cfg);
          if (url) links.set(cfg.key, url);
        }
      } catch (error) {
        errors.push({ competition: `catálogo Placard (${sport})`, error: error.message });
        for (const cfg of activeCompetitions.filter(c => c.sport === sport)) {
          diagnostics.push({ competition: cfg.label, reason: 'catalogo_placard_indisponivel', detail: error.message });
        }
      }
    }
    await forEachCompetitionIsolated(activeCompetitions, async cfg => {
        const url = links.get(cfg.key);
        if (!url) { diagnostics.push({ competition: cfg.label, reason: 'competicao_nao_confirmada_no_catalogo_placard',
          availableCompetitions: (sportCatalogs.get(cfg.sport) || []).slice(0, 80) }); return; }
        const games = (await scrapeCompetition(page, cfg, url)).filter(g => {
          const delta = Date.parse(g.commenceTime) - Date.now();
          return delta > 0 && delta <= 12 * 3600000;
        });
        if (!games.length) { diagnostics.push({ competition: cfg.label, reason: 'sem_jogos_12h' }); return; }
        const cacheRef = db.collection('_placard_pinnacle_latest').doc(cfg.key);
        const cacheSnap = await cacheRef.get();
        let events = cacheSnap.data()?.events || [];
        const notFoundProbes = cacheSnap.data()?.notFoundProbes || {};
        for (const [key, value] of Object.entries(notFoundProbes)) {
          if (!Number.isFinite(Date.parse(value)) || Date.now() - Date.parse(value) > 24 * 3600000) delete notFoundProbes[key];
        }
        events = events.map(e => ({ ...e, sport_key: cfg.key }));
        const dueEvents = new Map();
        const triggerSignatures = new Map();
        for (const game of games) {
          const matches = matchingEvents(game, events);
          const event = matches.length === 1 ? matches[0] : null;
          const delta = Date.parse(game.commenceTime) - Date.now();
          const near = event && isNearValue(game, event);
          const signature = near ? JSON.stringify(nearValueSelections(game, event)) : null;
          const gameKey = crypto.createHash('sha256').update(JSON.stringify([cfg.key, game.teams.map(normalize).sort(), game.commenceTime])).digest('hex');
          const stateRef = event ? db.collection('_placard_refresh_state').doc(`${cfg.key}_${event.id}`) : null;
          const eventState = stateRef ? ((await stateRef.get()).data() || {}) : {};
          if (near && event) {
            if (eventState.nearSignature !== signature) triggerSignatures.set(event.id, { ref: stateRef, signature });
          }
          const refreshDue = pinnacleRefreshDue(delta, eventState.lastPinnacleFetchAt, notFoundProbes[gameKey]);
          if (refreshDue || (event && triggerSignatures.has(event.id))) {
            if (event) dueEvents.set(event.id, event);
            else dueEvents.set(`new:${gameKey}`, null);
          }
        }
        let refreshedEvents = [];
        if (dueEvents.size) {
          const knownIds = [...dueEvents.keys()].filter(id => !id.startsWith('new:'));
          const markets = cfg.markets || ['h2h', 'totals', 'spreads'];
          const params = { bookmakers: 'pinnacle', markets: markets.join(','), oddsFormat: 'decimal' };
          if (knownIds.length === dueEvents.size) params.eventIds = knownIds.join(',');
          else {
            params.commenceTimeFrom = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
            params.commenceTimeTo = new Date(Date.now() + 12 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
          }
          try {
            const response = await api.get(`https://api.the-odds-api.com/v4/sports/${cfg.key}/odds`, { timeout: 20000, params });
            refreshedEvents = response.data.map(e => ({ ...e, sport_key: cfg.key }));
            const fetchedAt = new Date().toISOString();
            for (const key of dueEvents.keys()) {
              if (key.startsWith('new:')) notFoundProbes[key.slice(4)] = fetchedAt;
              else await db.collection('_placard_refresh_state').doc(`${cfg.key}_${key}`)
                .set({ lastPinnacleFetchAt: fetchedAt }, { merge: true });
            }
          } catch (error) {
            errors.push({ competition: cfg.label, error: error.message });
            diagnostics.push({ competition: cfg.label, reason: 'atualizacao_pinnacle_indisponivel', detail: error.message });
          }
          if (refreshedEvents.length) {
            const merged = new Map(events.map(e => [e.id, e]));
            for (const e of refreshedEvents) merged.set(e.id, e);
            const expiresAt = Date.now() + 12 * 3600000;
            events = [...merged.values()].filter(e => {
              const start = Date.parse(e.commence_time);
              return Number.isFinite(start) && start > Date.now() && start <= expiresAt;
            });
            await cacheRef.set({ events, notFoundProbes, updatedAt: new Date().toISOString() });
            for (const [eventId, state] of triggerSignatures) {
              if (refreshedEvents.some(e => e.id === eventId)) {
                await state.ref.set({ nearSignature: state.signature, updatedAt: new Date().toISOString() }, { merge: true });
              }
            }
            for (const game of games) {
              const match = matchingEvents(game, refreshedEvents);
              if (match.length !== 1 || !isNearValue(game, match[0])) continue;
              const eventId = match[0].id;
              const stateRef = db.collection('_placard_refresh_state').doc(`${cfg.key}_${eventId}`);
              const signature = JSON.stringify(nearValueSelections(game, match[0]));
              await stateRef.set({ nearSignature: signature, updatedAt: new Date().toISOString() }, { merge: true });
            }
          }
        }
        for (const game of games) {
          const matches = matchingEvents(game, refreshedEvents);
          let alternateError = null;
          if (matches.length === 1) {
            const totalLines = game.markets.filter(m => ['TPOT', 'HCTG'].includes(m.type))
              .flatMap(m => m.selections.filter(s => !s.unavailable && s.line !== null).map(s => Number(s.line)));
            const spreadLines = game.markets.filter(m => ['HCOT', 'TGHC'].includes(m.type)
              || /handicap|spread|hcap|hcp|sprd|hdc|hnd|^ah/i.test(`${m.type || ''} ${m.title || ''}`))
              .flatMap(m => m.selections.filter(s => !s.unavailable && s.line !== null).map((s, i) => ({
                selection: [matches[0].home_team, matches[0].away_team].find(name => namesEqual(game.teams[i], name)),
                line: Number(s.line),
              })));
            try {
              if (totalLines.length) await exactTotals(api, cfg.key, matches[0], totalLines, attemptedAlternates);
              if (spreadLines.length) await exactSpreads(api, cfg.key, matches[0], spreadLines, attemptedAlternates);
            }
            catch (e) { alternateError = e.message; }
          }
          const result = compare(game, refreshedEvents);
          const known = matchingEvents(game, events);
          const comparedSelections = known.length === 1 ? comparedSelectionCount(game, known[0]) : 0;
          const reason = result.reason === 'evento_sem_correspondencia' && known.length === 1
            ? 'preco_conhecido_aguardando_gatilho' : result.reason;
          diagnostics.push({ competition: cfg.label, teams: game.teams, reason,
            comparedSelections, confirmedSelections: result.comparedSelections ?? 0, alternateError });
          for (const row of result.rows) { await saveOpportunity(db, row); rows.push(row); }
        }
        if (refreshedEvents.length) await cacheRef.set({ events, notFoundProbes, updatedAt: new Date().toISOString() });
        const comparedSelections = games.reduce((sum, game) => {
          const matches = matchingEvents(game, events);
          return sum + (matches.length === 1 ? comparedSelectionCount(game, matches[0]) : 0);
        }, 0);
        await db.collection('_placard_reads').add({ observedAt: new Date().toISOString(), workflowRunId: scanRunId, apiSport: cfg.key,
          games, pinnacle: JSON.stringify(events), refreshedEventIds: refreshedEvents.map(e => e.id), comparedSelections });
    }, (cfg, error) => { errors.push({ competition: cfg.label, error: error.message }); });
  } finally { await browser.close(); }
  return { rows, errors, diagnostics, scanRunId, apiUsage: api.usage() };
}

async function processBookmakerRead(db, readId) {
  if (!readId || !/^[A-Za-z0-9_-]{1,120}$/.test(readId)) throw new Error('ID de leitura local inválido.');
  const readRef = db.collection('_bookmaker_reads').doc(readId);
  const readSnap = await readRef.get();
  if (!readSnap.exists) throw new Error(`Leitura local ${readId} não encontrada.`);
  const read = readSnap.data();
  const validationOnly = read.mode === 'validation';
  const soccerGate = (await db.collection('_bookmaker_validation').doc(`${String(read.bookmaker).toLowerCase()}_soccer`).get()).data();
  if (['processed', 'processed_with_errors'].includes(read.status)) return { rows: [], errors: read.errors || [], diagnostics: read.diagnostics || [], apiUsage: { creditsSpent: 0, calls: 0 } };
  if (!['dispatching', 'dispatched', 'ready'].includes(read.status)) throw new Error(`Leitura local ${readId} não está pronta (${read.status || 'sem_status'}).`);
  const gamesSnap = await readRef.collection('games').get();
  const games = gamesSnap.docs.map(doc => doc.data()).filter(game => game && game.apiSport && Array.isArray(game.teams));
  if (!games.length) throw new Error(`Leitura local ${readId} não contém jogos válidos.`);
  if (games.every(game => {
    const age = Date.now() - Date.parse(game.observedAt || '');
    return !Number.isFinite(age) || age < 0 || age > 120000;
  })) {
    const errors = [{ error: 'Leitura local antiga: todos os preços passaram de 120 segundos antes da comparação.' }];
    await readRef.set({ status: 'processed_with_errors', processedAt: new Date().toISOString(),
      comparedSelections: 0, opportunities: 0, errors, diagnostics: [], apiUsage: { creditsSpent: 0, calls: 0 } },
    { merge: true });
    return { rows: [], errors, diagnostics: [], apiUsage: { creditsSpent: 0, calls: 0 } };
  }

  const api = createOddsApiClient({ label: `bookmaker-${read.bookmaker || 'unknown'}` });
  const rows = [], errors = [], diagnostics = [], validations = [];
  const groups = new Map();
  for (const game of games) {
    if (!groups.has(game.apiSport)) groups.set(game.apiSport, []);
    groups.get(game.apiSport).push(game);
  }
  const attemptedAlternates = new Set();
  await forEachCompetitionIsolated([...groups.entries()], async ([sport, sportGames]) => {
    if (!validationOnly && sport.startsWith('soccer_') && soccerGate?.passed !== true) {
      throw new Error('Futebol bloqueado até validar 20 seleções contra Pinnacle.');
    }
    const markets = [...new Set(sportGames.flatMap(game => game.markets || []).flatMap(market => {
      if (['H2HT', 'HTOH', 'MRES'].includes(market.type)) return ['h2h'];
      if (['HCOT', 'TGHC'].includes(market.type)) return ['spreads'];
      if (['HCTG', 'TPOT'].includes(market.type)) return ['totals'];
      return [];
    }))];
    if (!markets.length) throw new Error('Leitura não contém mercados vencedor, handicap ou total reconhecidos.');
    const starts = sportGames.map(game => Date.parse(game.commenceTime)).filter(Number.isFinite);
    if (!starts.length) throw new Error('Leitura sem horário válido de início.');
    const params = { bookmakers: 'pinnacle', markets: markets.join(','), oddsFormat: 'decimal',
      commenceTimeFrom: new Date(Math.max(Date.now() - 5 * 60000, Math.min(...starts) - 10 * 60000)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      commenceTimeTo: new Date(Math.max(...starts) + 10 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z') };
    const { data } = await api.get(`https://api.the-odds-api.com/v4/sports/${sport}/odds`, { timeout: 20000, params });
    const events = (data || []).map(event => ({ ...event, sport_key: sport }));
    await forEachCompetitionIsolated(sportGames, async game => {
      let alternateError = null;
      const matches = matchingEvents(game, events);
      if (matches.length === 1) {
        const totalLines = (game.markets || []).filter(market => ['HCTG', 'TPOT'].includes(market.type))
          .flatMap(market => market.selections.filter(selection => !selection.unavailable && selection.line !== null)
            .map(selection => Number(selection.line)));
        const spreadLines = (game.markets || []).filter(market => ['HCOT', 'TGHC'].includes(market.type))
          .flatMap(market => market.selections.filter(selection => !selection.unavailable && selection.line !== null)
            .map((selection, index) => ({
              selection: game.teams.find(team => namesEqual(team, selection.name || selection.fullName)) || game.teams[index],
              line: Number(selection.line),
            })));
        try {
          if (totalLines.length) await exactTotals(api, sport, matches[0], totalLines, attemptedAlternates);
          if (spreadLines.length) await exactSpreads(api, sport, matches[0], spreadLines, attemptedAlternates);
        } catch (error) { alternateError = error.message; }
      }
      const comparison = compareBookmaker(read.bookmaker, game, events, Date.now(), { startToleranceMs: 10 * 60000 });
      if (matches.length === 1 && comparison.comparedSelections > 0) {
        const event = matches[0];
        const refs = references(event);
        for (const selection of placardSelections(game, event)) {
          const reference = refs.find(row => row.market === selection.market && row.line === selection.line && row.selection === selection.selection);
          if (reference) validations.push({ apiSport: sport, teams: game.teams, sourceEventId: game.sourceEventId,
            pinnacleEventId: event.id, sourceStart: game.commenceTime, pinnacleStart: event.commence_time,
            observedAt: game.observedAt, ...selection, ...reference });
        }
      }
      for (const row of comparison.rows) {
        row.sourceEventId = game.sourceEventId || null;
        row.sourceReadId = readId;
        if (!validationOnly) await saveOpportunity(db, row);
        rows.push(row);
      }
      diagnostics.push({ apiSport: sport, teams: game.teams, comparedSelections: comparison.comparedSelections || 0,
        opportunities: comparison.rows.length, reason: comparison.reason || null, alternateError });
    }, (game, error) => errors.push({ apiSport: sport, teams: game.teams, error: error.message }));
  }, (group, error) => { errors.push({ apiSport: group[0], error: error.message }); });
  if (validationOnly) {
    const soccer = validations.filter(row => row.apiSport.startsWith('soccer_'));
    const requiredMarkets = ['Bwin', 'ESC Online'].includes(read.bookmaker) ? ['totals'] : ['h2h', 'totals'];
    const passed = soccer.length >= 20 && requiredMarkets.every(market => soccer.some(row => row.market === market))
      && errors.length === 0;
    await db.collection('_bookmaker_validation').doc(`${String(read.bookmaker).toLowerCase()}_soccer`).set({
      passed, readId, validatedAt: new Date().toISOString(), selections: soccer.length, sample: soccer.slice(0, 20), errors,
      requiredMarkets,
    });
  }
  await readRef.set({ status: errors.length ? 'processed_with_errors' : 'processed', processedAt: new Date().toISOString(),
    comparedSelections: diagnostics.reduce((sum, row) => sum + row.comparedSelections, 0),
    opportunities: validationOnly ? 0 : rows.length, validationOnly, validations: validations.slice(0, 100), errors, diagnostics, apiUsage: api.usage() }, { merge: true });
  return { rows, errors, diagnostics, apiUsage: api.usage() };
}

async function captureClosing(db, entries) {
  const now = Date.now();
  const pending = entries.filter(e => e.closingStatus === 'pendente');
  const due = new Map();
  for (const e of pending) {
    const start = Date.parse(e.commenceTime);
    const ref = db.collection('_placard_opportunities').doc(e.id);
    if (now >= start) {
      const candidate = e.closingCandidate;
      // Só aceita preço realmente observado ANTES do início, fresco na
      // janela final de cinco minutos. Nunca usa preço ao vivo pós-início.
      if (candidate && Date.parse(candidate.capturedAt) < start && Date.parse(candidate.updatedAt) >= start - 300000 && Date.parse(candidate.updatedAt) < start) {
        await ref.update({ closingStatus: 'capturada', closingFairOdds: 1 / candidate.probability,
          closingUpdatedAt: candidate.updatedAt, closingCapturedAt: candidate.capturedAt,
          closingLeadSeconds: (start - Date.parse(candidate.updatedAt)) / 1000,
          clvPct: (e.placardOdds * candidate.probability - 1) * 100 });
      } else {
        await ref.update({ closingStatus: 'indisponivel', closingReason: 'sem_preco_pregame_na_mesma_linha_nos_ultimos_5min' });
      }
    } else if (start - now <= 5 * 60000) {
      if (!due.has(e.apiSport)) due.set(e.apiSport, []);
      due.get(e.apiSport).push(e);
    }
  }
  if (!due.size) return { creditsSpent: 0, calls: 0 };
  const api = createOddsApiClient({ label: 'placard-closing' });
  const attemptedAlternates = new Set();
  for (const [sport, group] of due) {
    try {
      const { data } = await api.get(`https://api.the-odds-api.com/v4/sports/${sport}/odds`, {
        timeout: 15000, params: { bookmakers: 'pinnacle', markets: [...new Set(group.map(e => e.market))].join(','), oddsFormat: 'decimal',
          eventIds: [...new Set(group.map(e => e.eventId))].join(',') },
      });
      for (const e of group) {
        if (Date.now() >= Date.parse(e.commenceTime)) continue;
        const event = data.find(ev => ev.id === e.eventId);
        const tolerance = closingStartTolerance(e, sport);
        if (!event || Math.abs(Date.parse(event.commence_time) - Date.parse(e.commenceTime)) > tolerance) continue;
        if (e.market === 'totals') {
          try { await exactTotals(api, sport, event, [e.line], attemptedAlternates, true); }
          catch (error) { console.error(`Linha de fechamento ${e.eventId}: ${error.message}`); }
        }
        if (e.market === 'spreads') {
          try { await exactSpreads(api, sport, event, [{ selection: e.selection, line: e.line }], attemptedAlternates, true); }
          catch (error) { console.error(`Handicap de fechamento ${e.eventId}: ${error.message}`); }
        }
        const capturedAt = new Date().toISOString();
        if (Date.parse(capturedAt) >= Date.parse(e.commenceTime)) continue;
        const candidate = references({ ...event, sport_key: sport }, Date.parse(capturedAt), true)
          .find(r => r.market === e.market && r.line === e.line && r.selection === e.selection);
        if (candidate && Date.parse(candidate.pinnacleUpdatedAt) >= Date.parse(e.commenceTime) - 300000) {
          await db.collection('_placard_opportunities').doc(e.id).update({ closingCandidate: {
            probability: candidate.probability, updatedAt: candidate.pinnacleUpdatedAt, capturedAt,
          } });
        }
      }
    } catch (e) { console.error(`Fechamento ${sport}: ${e.message}`); }
  }
  return api.usage();
}

async function publish(db, result, entries) {
  const generatedAt = new Date().toISOString();
  const runId = `r${generatedAt.replace(/[^0-9]/g, '')}`;
  const ref = db.collection('results').doc('placard_current');
  const run = ref.collection('runs').doc(runId);
  const pageCount = Math.ceil(result.rows.length / 100);
  for (let i = 0; i < pageCount; i++) await run.collection('pages').doc(String(i)).set({ rows: result.rows.slice(i * 100, (i + 1) * 100) });
  const budget = (await db.collection('_odds_api_budget').doc(generatedAt.slice(0, 7)).get()).data() || {};
  const budgetSummary = summarizeBudget(budget);
  const today = generatedAt.slice(0, 10);
  const payload = { generatedAt, runId, pageCount, report: report(entries), errors: result.errors,
    budget: { totalRemaining: budgetSummary.totalRemaining, available: budgetSummary.available,
      readingAvailable: budgetSummary.readingAvailable, closingReserve: CLOSING_RESERVE,
      keyCount: budgetSummary.keyCount, keyStatuses: budgetSummary.keyStatuses,
      lastSyncedAt: budgetSummary.lastSyncedAt,
      syncComplete: budgetSummary.syncComplete,
      todayUsage: budget.dailyUsage?.[today] || { total: 0, closing: 0, placardScan: 0, otherRead: 0, requests: 0 },
      lastScanCredits: result.apiUsage?.creditsSpent || 0, lastClosingCredits: result.closingUsage?.creditsSpent || 0 },
    cadenceMinutes: 30, priceMaxAgeSeconds: 120, closingWindowMinutes: 5 };
  await run.set({ ...payload, diagnostics: result.diagnostics });
  await ref.set(payload);
  return payload;
}

async function main() {
  loadEnvFileIfPresent();
  process.env.ODDS_API_ENFORCE_MONTHLY_BUDGET = '1';
  const db = database();
  const control = db.collection('_placard_control').doc('scan');
  if (process.argv.includes('--plan')) {
    const state = (await control.get()).data() || {};
    const hasBookmakerRead = Boolean(process.env.PLACARD_BOOKMAKER_READ_ID);
    const needsScan = !hasBookmakerRead && (process.env.PLACARD_FORCE_SCAN === '1' || !state.lastAttemptAt || Date.now() - Date.parse(state.lastAttemptAt) >= 30 * 60000);
    const pending = await db.collection('_placard_opportunities').where('closingStatus', '==', 'pendente').get();
    const needsClosing = process.env.PLACARD_CLOSING_ONLY === '1' || pending.docs.some(d => Date.parse(d.data().commenceTime) - Date.now() <= 5 * 60000);
    const output = `needs_scan=${needsScan}\nneeds_work=${hasBookmakerRead || needsScan || needsClosing}\n`;
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
    else console.log(output);
    return;
  }
  let entries = await allEntries(db);
  const existingIds = new Set(entries.map(e => e.id));
  // Fechamento tem prioridade sobre nova coleta.
  let closingUsage = await captureClosing(db, entries);
  if (process.env.PLACARD_CLOSING_ONLY === '1') {
    entries = await allEntries(db);
    const state = (await control.get()).data() || {};
    const result = state.result || { rows: [], errors: [], diagnostics: [] };
    result.closingUsage = closingUsage;
    const published = await publish(db, result, entries);
    fs.writeFileSync('placard_run_summary.json', JSON.stringify({ ...report(entries), budget: published.budget }, null, 2));
    return;
  }
  if (process.env.PLACARD_BOOKMAKER_READ_ID) {
    let result;
    try { result = await processBookmakerRead(db, process.env.PLACARD_BOOKMAKER_READ_ID); }
    catch (error) { result = { rows: [], errors: [{ error: error.message }], diagnostics: [], apiUsage: { creditsSpent: 0, calls: 0 } }; }
    entries = await allEntries(db);
    const afterReadClosing = await captureClosing(db, entries.filter(e => !existingIds.has(e.id)));
    closingUsage = { creditsSpent: (closingUsage?.creditsSpent || 0) + (afterReadClosing?.creditsSpent || 0),
      calls: (closingUsage?.calls || 0) + (afterReadClosing?.calls || 0) };
    entries = await allEntries(db);
    result.rows = entries.filter(e => e.closingStatus === 'pendente' && Date.parse(e.commenceTime) > Date.now());
    result.closingUsage = closingUsage;
    const published = await publish(db, result, entries);
    fs.writeFileSync('placard_run_summary.json', JSON.stringify({ ...report(entries), budget: published.budget,
      bookmakerReadId: process.env.PLACARD_BOOKMAKER_READ_ID,
      opportunities: result.rows.length, errors: result.errors }, null, 2));
    return;
  }
  const state = (await control.get()).data() || {};
  const due = process.env.PLACARD_FORCE_SCAN === '1' || !state.lastAttemptAt || Date.now() - Date.parse(state.lastAttemptAt) >= 30 * 60000;
  let result;
  if (due) {
    await control.set({ lastAttemptAt: new Date().toISOString() }, { merge: true });
    try { result = await scan(db, `${process.env.GITHUB_RUN_ID || 'local'}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`); }
    catch (e) { result = { rows: [], errors: [{ error: e.message }], diagnostics: [], apiUsage: { creditsSpent: 0, calls: 0 } }; }
    await control.set({ result }, { merge: true });
  } else result = state.result || { rows: [], errors: [], diagnostics: [] };
  entries = await allEntries(db);
  if (due) {
    // Oportunidade descoberta já nos minutos finais também precisa de
    // fechamento nesta execução, sem esperar o próximo cron.
    const afterScanClosing = await captureClosing(db, entries.filter(e => !existingIds.has(e.id) || Date.parse(e.commenceTime) <= Date.now()));
    closingUsage = { creditsSpent: (closingUsage?.creditsSpent || 0) + (afterScanClosing?.creditsSpent || 0),
      calls: (closingUsage?.calls || 0) + (afterScanClosing?.calls || 0) };
    entries = await allEntries(db);
  }
  result.rows = entries.filter(e => e.closingStatus === 'pendente' && Date.parse(e.commenceTime) > Date.now());
  result.closingUsage = closingUsage;
  const published = await publish(db, result, entries);
  fs.writeFileSync('placard_run_summary.json', JSON.stringify({ ...report(entries), budget: published.budget, scan: due,
    opportunities: result.rows.length, errors: result.errors }, null, 2));
  if (due && result.errors.length) console.warn(`Coleta parcial; as demais competições foram processadas: ${result.errors.map(e => `${e.competition || 'coleta'}: ${e.error}`).join(' | ')}`);
}
module.exports = { scan, processBookmakerRead, captureClosing, allEntries, publish, saveOpportunity, exactTotals, exactSpreads, closingStartTolerance, competitionUrl, forEachCompetitionIsolated, pinnacleRefreshDue };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
