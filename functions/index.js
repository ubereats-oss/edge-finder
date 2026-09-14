const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();

// Segredo compartilhado exigido no header X-Sync-Secret de toda chamada a
// syncOddsBr — guardado na configuração de segredos do Firebase (`firebase
// functions:secrets:set SYNC_ODDS_BR_SECRET`), nunca no código. Ver o
// comentário acima de `exports.syncOddsBr` pra quem precisa chamar essa
// function e o que configurar.
const SYNC_ODDS_BR_SECRET = defineSecret('SYNC_ODDS_BR_SECRET');
const SYNC_SECRET_HEADER = 'X-Sync-Secret';

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
  nba:    { col: 'results', doc: 'nba_props_br', minEdge: 10, calib: 'nba'    },
  nhl:    { col: 'results', doc: 'nhl_props',    minEdge: 15, calib: 'nhl'    },
  mlb:    { col: 'results', doc: 'mlb_props',    minEdge: 15, calib: 'nba'    },
  tennis: { col: 'results', doc: 'tennis_props', minEdge: 5,  calib: 'tennis' },
};

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

function calcKelly(prob, odds) {
  const b = odds - 1;
  const q = 1 - prob;
  const k = (prob * b - q) / b;
  return Math.max(0, parseFloat((k * 0.25 * 100).toFixed(2)));
}

function recalcProp(prop, oddsOverBR, oddsUnderBR, lineBR, calibTable) {
  const mu    = prop.playerAvg;
  const sigma = prop.playerStd;
  const line  = lineBR ?? prop.line;

  const pOverRaw  = 1 - normalCDF(line, mu, sigma);
  const pUnderRaw = normalCDF(line, mu, sigma);
  const pOver     = calibrate(pOverRaw, calibTable);
  const pUnder    = calibrate(pUnderRaw, calibTable);

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
    kelly:            calcKelly(bestProb, bestOdds),
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
  { region: 'southamerica-east1', cors: false, secrets: [SYNC_ODDS_BR_SECRET] },
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

    const calibTable = CALIB_TABLES[cfg.calib] || CALIB_TABLES.nba;

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

      if (recalculated.edge < cfg.minEdge) {
        toRemove.add(i);
        removed++;
        continue;
      }

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
