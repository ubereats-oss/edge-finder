const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const riskConfig = require('./risk_config');
const closingOddsRules = require('./closing_odds_rules');

initializeApp();
const db = getFirestore();

// Segredo compartilhado exigido no header X-Sync-Secret de toda chamada a
// syncOddsBr — guardado na configuração de segredos do Firebase (`firebase
// functions:secrets:set SYNC_ODDS_BR_SECRET`), nunca no código. Ver o
// comentário acima de `exports.syncOddsBr` pra quem precisa chamar essa
// function e o que configurar.
const SYNC_ODDS_BR_SECRET = defineSecret('SYNC_ODDS_BR_SECRET');
const SYNC_SECRET_HEADER = 'X-Sync-Secret';
const GH_DISPATCH_TOKEN = defineSecret('GH_DISPATCH_TOKEN');

// ── Tabelas de calibração ─────────────────────────────────────────────────────
const CALIB_TABLES = {
  nba: [
    { raw: 0.519, cal: 0.504 },
    { raw: 0.576, cal: 0.572 },
    { raw: 0.625, cal: 0.608 },
    { raw: 0.674, cal: 0.671 },
    { raw: 0.723, cal: 0.720 },
    { raw: 0.771, cal: 0.764 },
    { raw: 0.816, cal: 0.811 },
  ],
  nhl: [
    { raw: 0.521, cal: 0.531 },
    { raw: 0.578, cal: 0.534 },
    { raw: 0.623, cal: 0.534 },
    { raw: 0.675, cal: 0.539 },
    { raw: 0.723, cal: 0.576 },
    { raw: 0.771, cal: 0.587 },
    { raw: 0.822, cal: 0.618 },
    { raw: 0.871, cal: 0.625 },
    { raw: 0.922, cal: 0.639 },
  ],
  tennis: [
    { raw: 0.521, cal: 0.435 },
    { raw: 0.578, cal: 0.476 },
    { raw: 0.623, cal: 0.525 },
    { raw: 0.676, cal: 0.572 },
    { raw: 0.724, cal: 0.608 },
    { raw: 0.773, cal: 0.675 },
    { raw: 0.824, cal: 0.709 },
    { raw: 0.874, cal: 0.750 },
    { raw: 0.924, cal: 0.803 },
    { raw: 0.974, cal: 0.833 },
  ],
};

const SPORT_CONFIG = {
  nba:    { esporte: 'basketball/nba',    col: 'results', doc: 'nba_props_br', minEdge: 10, calib: 'nba'    },
  nhl:    { esporte: 'icehockey/nhl',     col: 'results', doc: 'nhl_props',    minEdge: 15, calib: 'nhl'    },
  // MLB não tem tabela de calibração própria e validada neste caminho —
  // `calib: null` faz recalcProp tratar como segmento "em_amostra" (ver
  // UNCALIBRATED_SHRINK_TO_RAW/UNCALIBRATED_STAKE_FRACTION abaixo), em vez
  // de usar a tabela de outro esporte.
  mlb:    { esporte: 'baseball/mlb',      col: 'results', doc: 'mlb_props',    minEdge: 15, calib: null    },
  tennis: { esporte: 'tennis',            col: 'results', doc: 'tennis_props', minEdge: 5,  calib: 'tennis' },
};

// Espelha pipeline/risk_config.js porque functions/ é implantado isolado.
const KELLY_FRACTION = riskConfig.KELLY_FRACTION;
const UNCALIBRATED_SHRINK_TO_RAW = riskConfig.UNCALIBRATED_SHRINK_TO_RAW;
const UNCALIBRATED_STAKE_FRACTION = riskConfig.UNCALIBRATED_STAKE_FRACTION;

// ── Matemática ────────────────────────────────────────────────────────────────
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCDF(x, mu, sigma) {
  if (sigma <= 0) return x >= mu ? 1 : 0;
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.sqrt(2))));
}

function calibrate(p, table) {
  if (p < 0.5) return 1 - calibrate(1 - p, table);
  const n = table.length;
  if (p <= table[0].raw) {
    const slope = (table[1].cal - table[0].cal) / (table[1].raw - table[0].raw);
    return Math.min(1, Math.max(0, table[0].cal + slope * (p - table[0].raw)));
  }
  if (p >= table[n - 1].raw) {
    const slope = (table[n - 1].cal - table[n - 2].cal) / (table[n - 1].raw - table[n - 2].raw);
    return Math.min(1, Math.max(0, table[n - 1].cal + slope * (p - table[n - 1].raw)));
  }
  for (let i = 0; i < n - 1; i++) {
    if (p >= table[i].raw && p <= table[i + 1].raw) {
      const t = (p - table[i].raw) / (table[i + 1].raw - table[i].raw);
      return table[i].cal + t * (table[i + 1].cal - table[i].cal);
    }
  }
  return p;
}

function calcKelly(prob, odds, stakeFraction = 1) {
  const b = odds - 1;
  const q = 1 - prob;
  const k = (prob * b - q) / b;
  return Math.max(0, parseFloat((k * KELLY_FRACTION * stakeFraction * 100).toFixed(2)));
}

// Mistura a bruta do modelo com a implícita de mercado — mesma fórmula do
// estado "em_amostra" de pipeline/calibration.js, pra esporte sem tabela de
// calibração própria neste caminho.
function shrinkToImplied(rawProb, impliedProb) {
  return UNCALIBRATED_SHRINK_TO_RAW * rawProb + (1 - UNCALIBRATED_SHRINK_TO_RAW) * impliedProb;
}

function recalcProp(prop, oddsOverBR, oddsUnderBR, lineBR, calibTable) {
  const mu    = prop.playerAvg;
  const sigma = prop.playerStd;
  const line  = lineBR ?? prop.line;

  const pOverRaw  = 1 - normalCDF(line, mu, sigma);
  const pUnderRaw = normalCDF(line, mu, sigma);

  let pOver, pUnder, stakeFraction;
  if (calibTable) {
    pOver = calibrate(pOverRaw, calibTable);
    pUnder = calibrate(pUnderRaw, calibTable);
    stakeFraction = 1;
  } else {
    pOver = shrinkToImplied(pOverRaw, 1 / oddsOverBR);
    pUnder = shrinkToImplied(pUnderRaw, 1 / oddsUnderBR);
    stakeFraction = UNCALIBRATED_STAKE_FRACTION;
  }

  const edgeOver  = pOver  - 1 / oddsOverBR;
  const edgeUnder = pUnder - 1 / oddsUnderBR;

  const bestSide = edgeOver >= edgeUnder ? 'Over'     : 'Under';
  const bestProb = edgeOver >= edgeUnder ? pOver      : pUnder;
  const bestOdds = edgeOver >= edgeUnder ? oddsOverBR : oddsUnderBR;
  const bestEdge = edgeOver >= edgeUnder ? edgeOver   : edgeUnder;

  return {
    ...prop,
    line,
    oddsOver:         oddsOverBR,
    oddsUnder:        oddsUnderBR,
    side:             bestSide,
    odds:             bestOdds,
    modelProb:        parseFloat((bestProb * 100).toFixed(1)),
    impliedProb:      parseFloat(((1 / bestOdds) * 100).toFixed(1)),
    edge:             parseFloat((bestEdge * 100).toFixed(2)),
    kelly:            calcKelly(bestProb, bestOdds, stakeFraction),
    inefficientMarket: !prop.lowSample && (bestEdge * 100) >= 20,
    formWarning:      prop.playerAvg5 !== null &&
                      (bestSide === 'Over' ? prop.playerAvg5 < line : prop.playerAvg5 > line),
    _brSync:          new Date().toISOString(),
  };
}

function normName(n) {
  return (n || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim();
}

function findPlayer(propPlayer, scrapedOdds) {
  const norm = normName(propPlayer);
  for (const [name, data] of Object.entries(scrapedOdds)) {
    const n = normName(name);
    if (n === norm) return data;
    const parts = norm.split(' ');
    if (parts.length >= 2 && n.includes(parts[parts.length - 1])) return data;
  }
  return null;
}

// ── Segurança / validação de entrada ────────────────────────────────────────

// Comparação em tempo constante — evita que o tempo de resposta revele
// quantos caracteres do segredo estavam corretos.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// { over, under, line } — over/under são odds decimais (sempre > 1 no
// mercado real; teto de 1000 só como sanidade contra valor absurdo/typo).
function isValidOddsEntry(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    && isFiniteNumber(v.over) && v.over > 1 && v.over < 1000
    && isFiniteNumber(v.under) && v.under > 1 && v.under < 1000
    && isFiniteNumber(v.line);
}

// odds: { "Nome do Jogador": { prop: {over, under, line}, ... }, ... } —
// rejeita qualquer coisa fora desse formato, incluindo objeto vazio.
function isValidOddsPayload(odds) {
  if (!odds || typeof odds !== 'object' || Array.isArray(odds)) return false;
  const players = Object.keys(odds);
  if (!players.length) return false;
  for (const player of players) {
    if (typeof player !== 'string' || !player.trim()) return false;
    const props = odds[player];
    if (!props || typeof props !== 'object' || Array.isArray(props)) return false;
    const propKeys = Object.keys(props);
    if (!propKeys.length) return false;
    for (const propKey of propKeys) {
      if (!isValidOddsEntry(props[propKey])) return false;
    }
  }
  return true;
}

/**
 * POST /syncOddsBr
 *
 * Chamada manual/semiautomática (script de scraping via agente + browser,
 * ver prompt_claude_chrome_sync_br.md na raiz do repo) — não é chamada por
 * nenhuma página web pública, por isso CORS fica desabilitado.
 *
 * Requer o header X-Sync-Secret com o valor configurado no segredo
 * SYNC_ODDS_BR_SECRET (`firebase functions:secrets:set SYNC_ODDS_BR_SECRET`).
 * Sem o header, ou com valor errado, a requisição é rejeitada com 401
 * genérico antes de tocar no Firestore.
 *
 * Body JSON:
 * {
 *   "sport": "nba",                          // nba | nhl | mlb | tennis
 *   "odds": {                                 // odds scraped do site BR
 *     "LeBron James": {
 *       "points": { "over": 1.87, "under": 1.95, "line": 25.5 }
 *     }
 *   }
 * }
 *
 * Retorna:
 * { "updated": 3, "removed": 1, "unchanged": 12 }
 */
exports.syncOddsBr = onRequest(
  { region: 'southamerica-east1', cors: false, secrets: [SYNC_ODDS_BR_SECRET, GH_DISPATCH_TOKEN] },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Segredo compartilhado — validado antes de qualquer leitura/escrita no
    // Firestore. Resposta genérica (não diferencia "faltando" de "errado")
    // e o log nunca inclui o valor recebido nem o configurado.
    const expectedSecret = SYNC_ODDS_BR_SECRET.value() || '';
    const providedSecret = req.get(SYNC_SECRET_HEADER) || '';
    if (!expectedSecret || !providedSecret || !safeEqual(providedSecret, expectedSecret)) {
      console.warn(`[syncOddsBr] requisição rejeitada: segredo ausente ou inválido (ip=${req.ip ?? 'desconhecido'}).`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { sport, odds } = req.body || {};

    const cfg = SPORT_CONFIG[sport];
    if (!cfg) {
      console.warn(`[syncOddsBr] requisição rejeitada: esporte inválido (sport=${JSON.stringify(sport)}).`);
      return res.status(400).json({ error: `Esporte inválido: ${sport}` });
    }

    if (!isValidOddsPayload(odds)) {
      console.warn(`[syncOddsBr] requisição rejeitada: formato de odds inválido (sport=${sport}).`);
      return res.status(400).json({ error: 'Campo odds ausente ou em formato inválido' });
    }

    const calibTable = cfg.calib ? (CALIB_TABLES[cfg.calib] || CALIB_TABLES.nba) : null;
    const githubToken = GH_DISPATCH_TOKEN.value();
    if (!githubToken) {
      console.error('[syncOddsBr] segredo GH_DISPATCH_TOKEN ausente — abortando para não dessíncronizar app e histórico central.');
      return res.status(500).json({ error: 'Histórico central indisponível' });
    }

    // Lê props do Firestore
    const snap = await db.collection(cfg.col).doc(cfg.doc).get();
    if (!snap.exists) {
      return res.status(404).json({ error: `Documento ${cfg.col}/${cfg.doc} não encontrado` });
    }

    const raw   = snap.data();
    const props = Array.isArray(raw.data) ? [...raw.data] : [];

    let updated = 0, removed = 0, unchanged = 0;
    const toRemove = new Set();

    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      const playerOdds = findPlayer(prop.player, odds);
      if (!playerOdds) continue;

      const propOdds = playerOdds[prop.prop];
      if (!propOdds) continue;

      const { over: oddsOverBR, under: oddsUnderBR, line: lineBR } = propOdds;

      const lineChanged = Math.abs(lineBR - prop.line) > 0.01;
      const oddsChanged = Math.abs(oddsOverBR - prop.oddsOver) > 0.001 ||
                          Math.abs(oddsUnderBR - prop.oddsUnder) > 0.001;

      if (!lineChanged && !oddsChanged) { unchanged++; continue; }

      const recalculated = recalcProp(prop, oddsOverBR, oddsUnderBR, lineBR, calibTable);
      recalculated.bookmaker = prop.bookmaker ?? 'Pinnacle';
      recalculated.indicationId = indicationIdFor(recalculated);

      if (recalculated.edge < cfg.minEdge) {
        await applySyncOddsBrToLedger(githubToken, cfg, prop, recalculated, 'removed');
        toRemove.add(i);
        removed++;
        continue;
      }

      const syncedLedgerEntry = await applySyncOddsBrToLedger(
        githubToken,
        cfg,
        prop,
        recalculated,
        lineChanged ? 'line_changed' : 'odds_changed'
      );
      recalculated.indicationId = syncedLedgerEntry.indicationId ?? syncedLedgerEntry._key;
      recalculated.ledgerKey = syncedLedgerEntry._key ?? recalculated.indicationId;
      props[i] = recalculated;
      updated++;
    }

    if (updated === 0 && removed === 0) {
      return res.json({ updated: 0, removed: 0, unchanged, message: 'Sem alterações' });
    }

    const final = props.filter((_, i) => !toRemove.has(i));
    final.sort((a, b) => b.edge - a.edge);

    await db.collection(cfg.col).doc(cfg.doc).set({
      data:        final,
      lastUpdated: new Date().toISOString(),
      updatedAt:   FieldValue.serverTimestamp(),
    });

    return res.json({ updated, removed, unchanged, total: final.length });
  }
);

// ── Disparo just-in-time de "Capturar Odd de Fechamento" ───────────────────
//
// Substitui a espera de até 5h dentro do runner do GitHub Actions: esta
// function roda a cada poucos minutos, lê o histórico central
// (odds_history/model_ledger_*.json) direto da branch `data` do GitHub e
// reimplementa a mesma seleção de "próximo evento alcançável" de
// pipeline/capture_closing_odds.js — futuro priorizado sobre já iniciado
// (ver comentário de findNextReachableEvent abaixo). Quando o próximo
// evento entra na janela de disparo (~3min antes do início), chama a API do
// GitHub pra disparar workflow_dispatch no workflow
// capture_closing_odds.yml, que agora roda, captura o que estiver na janela
// e encerra — sem espera. O cron de 3 em 3h do próprio workflow continua
// existindo como rede de segurança.
//
// Requer o segredo GH_DISPATCH_TOKEN (`firebase functions:secrets:set
// GH_DISPATCH_TOKEN`) — um GitHub PAT com Contents: write (syncOddsBr grava
// odds_history na branch data) e Actions: write / workflow (closingOddsScheduler
// dispara o workflow de captura).
const GH_OWNER = 'ubereats-oss';
const GH_REPO = 'edge-finder';
const GH_DATA_REF = 'data';
const GH_WORKFLOW_FILE = 'capture_closing_odds.yml';
const GH_WORKFLOW_REF = 'main';
const SYNC_BR_REJECTION_REASON = 'sync_br_edge_insuficiente';

const MIN_RETRY_INTERVAL_MS = closingOddsRules.MIN_RETRY_INTERVAL_MS;

const SCHEDULER_STATE_DOC = db.collection('system').doc('closingOddsScheduler');

async function ghFetchJson(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function monthOf(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 7);
  return d.toISOString().slice(0, 7);
}

function sportSlug(esporte) {
  return esporte && esporte.includes('/') ? esporte.split('/')[1] : esporte;
}

function makeLedgerKey({ eventId, player, market, line, side }) {
  return `${eventId}|${player}|${market}|${line}|${side}`;
}

function indicationIdFor(prop) {
  return makeLedgerKey({
    eventId: prop.eventId ?? prop.gameId ?? prop.pinnacleId ?? `${prop.game}|${prop.commence_time ?? prop.commenceTime}`,
    player: prop.player,
    market: prop.market ?? prop.prop,
    line: prop.line,
    side: prop.side,
  });
}

function ensureOriginalRecommendation(entry) {
  if (entry.originalRecommendation) return entry.originalRecommendation;
  return {
    line: entry.line,
    side: entry.side,
    odds: entry.odds,
    modelProb: entry.modelProb,
    impliedProb: entry.impliedProb,
    edge: entry.edge,
    kelly: entry.kelly,
    bookmaker: entry.bookmaker ?? null,
    evaluatedAt: entry.evaluatedAt ?? null,
  };
}

async function loadLedgerPartitionForEntry(token, esporte, commenceTime) {
  const month = monthOf(commenceTime);
  const fileName = `model_ledger_${sportSlug(esporte)}_${month}.json`;
  const path = `odds_history/${fileName}`;
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_DATA_REF}`;
  try {
    const file = await ghFetchJson(url, token);
    const content = Buffer.from(file.content || '', 'base64').toString('utf8');
    const entries = JSON.parse(content || '[]');
    return { path, sha: file.sha, entries: Array.isArray(entries) ? entries : [] };
  } catch (e) {
    if (String(e.message).includes('GitHub API 404')) return { path, sha: null, entries: [] };
    throw e;
  }
}

async function saveLedgerPartition(token, partition, message) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${partition.path}`;
  const body = {
    message,
    branch: GH_DATA_REF,
    content: Buffer.from(JSON.stringify(partition.entries, null, 2) + '\n', 'utf8').toString('base64'),
  };
  if (partition.sha) body.sha = partition.sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const err = new Error(`GitHub ledger conflict 409: ${(await res.text()).slice(0, 300)}`);
    err.code = 'LEDGER_CONFLICT';
    throw err;
  }
  if (!res.ok) throw new Error(`GitHub ledger write ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

function applySyncOddsBrChangeToPartition(partition, cfg, prop, recalculated, action) {
  const originalId = prop.indicationId ?? prop.ledgerKey ?? indicationIdFor(prop);
  const originalKey = prop.ledgerKey ?? originalId;
  const idx = partition.entries.findIndex(e => (e.indicationId ?? e._key) === originalId || e._key === originalKey);
  if (idx === -1) {
    throw new Error(`entrada ${originalId} não encontrada no histórico central`);
  }

  const now = new Date().toISOString();
  const original = partition.entries[idx];
  original.indicationId = original.indicationId ?? original._key ?? originalId;
  original.originalRecommendation = ensureOriginalRecommendation(original);
  original.syncHistory = [
    ...(Array.isArray(original.syncHistory) ? original.syncHistory : []),
    {
      source: 'syncOddsBr',
      action,
      syncedAt: now,
      previous: {
        line: original.line,
        side: original.side,
        odds: original.odds,
        modelProb: original.modelProb,
        impliedProb: original.impliedProb,
        edge: original.edge,
        kelly: original.kelly,
        bookmaker: original.bookmaker ?? null,
      },
      next: {
        line: recalculated.line,
        side: recalculated.side,
        odds: recalculated.odds,
        modelProb: recalculated.modelProb,
        impliedProb: recalculated.impliedProb,
        edge: recalculated.edge,
        kelly: recalculated.kelly,
        bookmaker: recalculated.bookmaker ?? prop.bookmaker ?? null,
      },
    },
  ];

  if (action === 'removed') {
    original.published = false;
    original.unpublishedBySync = true;
    original.rejectionReason = SYNC_BR_REJECTION_REASON;
    original.syncRemovedAt = now;
    original.validForCalibration = original.validForCalibration !== false;
    return original;
  }

  if (action === 'line_changed') {
    const replacementId = indicationIdFor(recalculated);
    original.published = false;
    original.replacedBy = replacementId;
    original.replacedAt = now;
    original.replacementReason = 'sync_br_linha_alterada';
    original.validForCalibration = original.validForCalibration !== false;

    const existingReplacement = partition.entries.find(e => (e.indicationId ?? e._key) === replacementId);
    const replacement = {
      ...original,
      ...recalculated,
      _key: replacementId,
      indicationId: replacementId,
      eventId: original.eventId,
      game: original.game,
      commenceTime: original.commenceTime,
      player: original.player,
      market: original.market,
      line: recalculated.line,
      side: recalculated.side,
      odds: recalculated.odds,
      modelProb: recalculated.modelProb,
      rawProb: original.rawProb ?? null,
      impliedProb: recalculated.impliedProb,
      edge: recalculated.edge,
      kelly: recalculated.kelly,
      bookmaker: recalculated.bookmaker ?? original.bookmaker ?? null,
      published: true,
      rejectionReason: null,
      replacedBy: null,
      replacedAt: null,
      source: 'syncOddsBr',
      originalIndicationId: original.indicationId,
      replacedFrom: original.indicationId,
      replacementCreatedAt: now,
      replacementReason: null,
      unpublishedBySync: null,
      syncRemovedAt: null,
      evaluatedAt: now,
      firstEvaluatedAt: original.firstEvaluatedAt ?? original.evaluatedAt ?? now,
      result: existingReplacement?.result ?? null,
      resolutionAttempts: existingReplacement?.resolutionAttempts ?? 0,
      resolutionStatus: existingReplacement?.resolutionStatus ?? 'pendente',
      closingOdds: existingReplacement?.closingOdds ?? null,
      clv: existingReplacement?.clv ?? null,
      closingOddsStatus: existingReplacement?.closingOddsStatus ?? 'pendente',
      syncHistory: existingReplacement?.syncHistory ?? [],
    };
    if (existingReplacement) Object.assign(existingReplacement, replacement);
    else partition.entries.push(replacement);
    return replacement;
  }

  original.line = recalculated.line;
  original.side = recalculated.side;
  original.odds = recalculated.odds;
  original.modelProb = recalculated.modelProb;
  original.impliedProb = recalculated.impliedProb;
  original.edge = recalculated.edge;
  original.kelly = recalculated.kelly;
  original.bookmaker = recalculated.bookmaker ?? original.bookmaker ?? null;
  original.syncUpdatedAt = now;
  return original;
}

async function applySyncOddsBrToLedger(token, cfg, prop, recalculated, action) {
  const esporte = cfg.esporte;
  const originalId = prop.indicationId ?? prop.ledgerKey ?? indicationIdFor(prop);
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const partition = await loadLedgerPartitionForEntry(token, esporte, prop.commence_time ?? prop.commenceTime);
    const applied = applySyncOddsBrChangeToPartition(partition, cfg, prop, recalculated, action);
    try {
      await saveLedgerPartition(token, partition, `ledger: syncOddsBr ${action} ${originalId}`);
      return applied;
    } catch (e) {
      if (e.code !== 'LEDGER_CONFLICT' || attempt === maxAttempts) throw e;
      console.warn(`[syncOddsBr] conflito ao gravar histórico central (${originalId}); relendo e reaplicando tentativa ${attempt + 1}/${maxAttempts}.`);
    }
  }
  throw new Error(`falha ao gravar histórico central após ${maxAttempts} tentativas`);
}

// Lê todas as partições model_ledger_*.json da branch `data` — uma chamada
// pra listar o diretório, uma por arquivo (usando a download_url assinada
// devolvida pelo próprio GitHub, sem precisar de auth de novo).
async function loadLedgerEntries(token) {
  const listUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/odds_history?ref=${GH_DATA_REF}`;
  const files = await ghFetchJson(listUrl, token);
  const ledgerFiles = (Array.isArray(files) ? files : [])
    .filter(f => f.type === 'file' && /^model_ledger_.*\.json$/.test(f.name) && f.download_url);

  const entries = [];
  for (const f of ledgerFiles) {
    try {
      const res = await fetch(f.download_url);
      if (!res.ok) {
        console.warn(`[closingOddsScheduler] falha ao baixar ${f.name}: ${res.status}`);
        continue;
      }
      const parsed = await res.json();
      if (Array.isArray(parsed)) entries.push(...parsed);
    } catch (e) {
      console.warn(`[closingOddsScheduler] erro lendo ${f.name}: ${e.message}`);
    }
  }
  return entries;
}

async function dispatchCaptureWorkflow(token) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: GH_WORKFLOW_REF }),
  });
  if (!res.ok) throw new Error(`dispatch ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

exports.closingOddsScheduler = onSchedule(
  { region: 'southamerica-east1', schedule: 'every 30 minutes', secrets: [GH_DISPATCH_TOKEN] },
  async () => {
    const token = GH_DISPATCH_TOKEN.value();
    if (!token) {
      console.error('[closingOddsScheduler] segredo GH_DISPATCH_TOKEN ausente — abortando.');
      return;
    }

    let entries;
    try {
      entries = await loadLedgerEntries(token);
    } catch (e) {
      console.error(`[closingOddsScheduler] falha ao ler histórico central: ${e.message}`);
      return;
    }

    const now = Date.now();
    const target = closingOddsRules.findNextReachableEvent(entries, now);
    if (!target) {
      console.log('[closingOddsScheduler] nenhuma indicação pendente sem odd de fechamento dentro da janela — nada a disparar.');
      return;
    }

    const stateSnap = await SCHEDULER_STATE_DOC.get();
    const state = stateSnap.exists ? stateSnap.data() : {};
    const lastDispatchAt = state.lastDispatchAt?.toMillis?.() ?? 0;
    const lastDispatchKey = state.lastDispatchKey ?? null;

    const decision = closingOddsRules.shouldDispatchCapture(target, now, { lastDispatchAt, lastDispatchKey });
    if (!decision.dispatch) {
      if (decision.reason === 'intervalo_minimo') {
        console.log(`[closingOddsScheduler] alvo já iniciado (${target.label}) — intervalo mínimo de ${Math.round(MIN_RETRY_INTERVAL_MS / 60000)}min ainda não passou, não disparando.`);
      } else if (decision.reason === 'fora_janela_disparo') {
        console.log(`[closingOddsScheduler] próximo evento alcançável (${target.label}) ainda a ${Math.round(decision.faltamMs / 60000)}min — fora da janela de disparo, aguardando próxima execução.`);
      } else if (decision.reason === 'dedupe') {
        console.log(`[closingOddsScheduler] já disparado recentemente para ${target.label} — evitando disparo duplicado.`);
      }
      return;
    }

    try {
      await dispatchCaptureWorkflow(token);
    } catch (e) {
      console.error(`[closingOddsScheduler] falha ao disparar workflow_dispatch: ${e.message}`);
      return;
    }

    await SCHEDULER_STATE_DOC.set({
      lastDispatchAt: FieldValue.serverTimestamp(),
      lastDispatchKey: target.key,
      lastDispatchLabel: target.label,
    }, { merge: true });

    console.log(`[closingOddsScheduler] workflow disparado para ${target.label} (${decision.jaIniciado ? 'já iniciado' : `faltam ~${Math.round((target.commence - now) / 60000)}min`}).`);
  }
);
