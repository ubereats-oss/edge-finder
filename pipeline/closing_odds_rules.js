const RESOLUTION_STATUS_PENDENTE = 'pendente';
const CLOSING_ODDS_STATUS_PENDENTE = 'pendente';
const CLOSING_ODDS_STATUS_CAPTURADA = 'capturada';

const CLOSING_ODDS_CAPTURE_WINDOW_BEFORE_MS = 2 * 60 * 60 * 1000;
const CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS = 10 * 60 * 1000;
const TARGET_LEAD_MS = 35 * 60 * 1000;
const MIN_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const DISPATCH_DEDUPE_MS = 3 * 60 * 1000;

const SPORT_MARKET_KEYS = {
  'basketball/nba': ['points', 'rebounds', 'assists', 'steals', 'threes'],
  'baseball/mlb': ['hits', 'strikeouts', 'hitsAllowed'],
  'hockey/nhl': ['points', 'goals', 'assists', 'shots'],
  'americanfootball/nfl': ['passYards', 'passTDs', 'rushYards', 'receptions', 'receptionYards'],
};

function closingOddsStatusOf(entry) {
  if (entry.closingOddsStatus) return entry.closingOddsStatus;
  return (entry.closingOdds !== null && entry.closingOdds !== undefined)
    ? CLOSING_ODDS_STATUS_CAPTURADA
    : CLOSING_ODDS_STATUS_PENDENTE;
}

function isClosingOddsEligible(entry) {
  if (entry.hasModelProb === false || entry.validForCalibration === false) return false;
  if (entry.resolutionStatus !== RESOLUTION_STATUS_PENDENTE) return false;
  if (closingOddsStatusOf(entry) !== CLOSING_ODDS_STATUS_PENDENTE) return false;

  const markets = SPORT_MARKET_KEYS[entry.esporte];
  return !!markets && markets.includes(entry.market);
}

function isWithinCaptureWindow(entry, now) {
  const commence = new Date(entry.commenceTime).getTime();
  if (isNaN(commence)) return false;
  const delta = commence - now;
  return delta <= CLOSING_ODDS_CAPTURE_WINDOW_BEFORE_MS
    && delta >= -CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS;
}

function groupEntriesForCapture(entries, esporte, markets, now) {
  let semJanela = 0;
  const porEvento = new Map();

  for (const entry of entries) {
    if (entry.esporte !== esporte) continue;
    if (!isClosingOddsEligible(entry)) continue;
    if (!markets[entry.market]) continue;
    if (!isWithinCaptureWindow(entry, now)) {
      semJanela++;
      continue;
    }

    if (!porEvento.has(entry.eventId)) porEvento.set(entry.eventId, []);
    porEvento.get(entry.eventId).push(entry);
  }

  return { porEvento, semJanela };
}

function findNextReachableEvent(entries, now) {
  let bestFuture = null;
  let bestStarted = null;

  for (const entry of entries) {
    if (!isClosingOddsEligible(entry)) continue;

    const commence = new Date(entry.commenceTime).getTime();
    if (isNaN(commence)) continue;

    const candidate = {
      commence,
      key: `${entry.eventId}|${entry.player}|${entry.market}|${entry.line}|${entry.side}`,
      label: `${entry.esporte} ${entry.player} ${entry.market} ${entry.side} ${entry.line}`,
    };

    if (commence >= now) {
      if (bestFuture === null || commence < bestFuture.commence) bestFuture = candidate;
    } else if (bestStarted === null || commence < bestStarted.commence) {
      bestStarted = candidate;
    }
  }

  return bestFuture || bestStarted;
}

function shouldDispatchCapture(target, now, state) {
  if (!target) return { dispatch: false, reason: 'sem_alvo' };

  const lastDispatchAt = state.lastDispatchAt ?? 0;
  const lastDispatchKey = state.lastDispatchKey ?? null;
  const jaIniciado = target.commence < now;

  if (jaIniciado) {
    if (now - lastDispatchAt < MIN_RETRY_INTERVAL_MS) {
      return { dispatch: false, reason: 'intervalo_minimo', jaIniciado };
    }
    return { dispatch: true, reason: 'alvo_iniciado', jaIniciado };
  }

  const faltamMs = target.commence - now;
  if (faltamMs > TARGET_LEAD_MS) {
    return { dispatch: false, reason: 'fora_janela_disparo', jaIniciado, faltamMs };
  }
  if (target.key === lastDispatchKey && now - lastDispatchAt < DISPATCH_DEDUPE_MS) {
    return { dispatch: false, reason: 'dedupe', jaIniciado };
  }

  return { dispatch: true, reason: 'alvo_futuro', jaIniciado, faltamMs };
}

module.exports = {
  CLOSING_ODDS_CAPTURE_WINDOW_BEFORE_MS,
  CLOSING_ODDS_CAPTURE_WINDOW_AFTER_MS,
  TARGET_LEAD_MS,
  MIN_RETRY_INTERVAL_MS,
  DISPATCH_DEDUPE_MS,
  SPORT_MARKET_KEYS,
  closingOddsStatusOf,
  isClosingOddsEligible,
  isWithinCaptureWindow,
  groupEntriesForCapture,
  findNextReachableEvent,
  shouldDispatchCapture,
};
