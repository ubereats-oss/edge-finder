function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCDF(x, mu, sigma) {
  if (sigma <= 0) return x >= mu ? 1 : 0;
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.sqrt(2))));
}

function invNormalCDF(p) {
  if (p <= 0 || p >= 1) return null;
  let lo = -8, hi = 8;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const cdf = normalCDF(mid, 0, 1);
    if (cdf < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function poissonCDF(k, lambda) {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPMF(i, lambda);
  return Math.min(1, sum);
}

function devigTwoWay(overOdds, underOdds) {
  if (!(overOdds > 1) || !(underOdds > 1)) return null;
  const overImp = 1 / overOdds;
  const underImp = 1 / underOdds;
  const total = overImp + underImp;
  if (!(total > 0)) return null;
  return { over: overImp / total, under: underImp / total };
}

function movementDirection(side, originalLine, closingLine) {
  if (closingLine === originalLine) return 'neutro';
  if (side === 'Over') return closingLine > originalLine ? 'a_favor' : 'contra';
  if (side === 'Under') return closingLine < originalLine ? 'a_favor' : 'contra';
  return 'neutro';
}

function estimateNormalProbAtOriginal({ side, originalLine, closingLine, closingFairProb, sigma }) {
  if (!(sigma > 0) || !(closingFairProb > 0) || !(closingFairProb < 1)) return null;
  const z = side === 'Over'
    ? invNormalCDF(1 - closingFairProb)
    : invNormalCDF(closingFairProb);
  if (z === null) return null;
  const mu = closingLine - z * sigma;
  const p = side === 'Over'
    ? 1 - normalCDF(originalLine, mu, sigma)
    : normalCDF(originalLine, mu, sigma);
  return Math.max(0, Math.min(1, p));
}

function estimatePoissonProbAtOriginal({ side, originalLine, closingLine, closingFairProb }) {
  if (!(closingFairProb > 0) || !(closingFairProb < 1)) return null;
  let lo = 0.0001, hi = 12;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const p = side === 'Over'
      ? 1 - poissonCDF(Math.floor(closingLine), mid)
      : poissonCDF(Math.floor(closingLine), mid);
    if (side === 'Over') {
      if (p < closingFairProb) lo = mid;
      else hi = mid;
    } else {
      if (p > closingFairProb) lo = mid;
      else hi = mid;
    }
  }
  const lambda = (lo + hi) / 2;
  return side === 'Over'
    ? 1 - poissonCDF(Math.floor(originalLine), lambda)
    : poissonCDF(Math.floor(originalLine), lambda);
}

function adjustedClosingProbability(entry, closing, modelContext = {}) {
  const fair = devigTwoWay(closing.overOdds, closing.underOdds);
  if (!fair) return null;
  const side = entry.side;
  const closingFairProb = side === 'Over' ? fair.over : fair.under;
  if (entry.market === 'passTDs') {
    return estimatePoissonProbAtOriginal({
      side,
      originalLine: entry.line,
      closingLine: closing.line,
      closingFairProb,
    });
  }
  const sigma = entry.playerStd ?? modelContext.playerStd;
  return estimateNormalProbAtOriginal({
    side,
    originalLine: entry.line,
    closingLine: closing.line,
    closingFairProb,
    sigma,
  });
}

function adjustedClv(entry, closing, modelContext = {}) {
  const p = adjustedClosingProbability(entry, closing, modelContext);
  if (!(p > 0)) return null;
  const fairOddsAtOriginalLine = 1 / p;
  return parseFloat(((entry.odds / fairOddsAtOriginalLine - 1) * 100).toFixed(2));
}

// Fechamento "sem margem": devigga H2H/Over-Under de cada casa (região já
// buscada pra capturar a odd de fechamento normal, nenhuma chamada nova) na
// MESMA linha/lado da indicação original e tira a média das probabilidades
// justas entre as casas — ou usa só a Pinnacle quando ela cotar essa linha
// (referência mais líquida/menos distorcida que qualquer casa isolada).
// market: objeto de mercado de UM bookmaker (bm.markets.find(m => m.key === marketKey)).
function fairProbFromMarket(market, player, line, side, isH2h) {
  if (!market) return null;
  if (isH2h) {
    const mine = market.outcomes?.find(o => o.name === player);
    const outra = market.outcomes?.find(o => o.name !== player);
    if (!mine || !outra || typeof mine.price !== 'number' || typeof outra.price !== 'number') return null;
    const fair = devigTwoWay(mine.price, outra.price);
    return fair?.over ?? null; // devigTwoWay(mine, outra) -> .over é a prob. do 1º argumento (mine)
  }
  const over = market.outcomes?.find(o => o.description === player && o.point === line && o.name === 'Over');
  const under = market.outcomes?.find(o => o.description === player && o.point === line && o.name === 'Under');
  if (!over || !under || typeof over.price !== 'number' || typeof under.price !== 'number') return null;
  const fair = devigTwoWay(over.price, under.price);
  if (!fair) return null;
  return side === 'Over' ? fair.over : fair.under;
}

function noVigClosingClv({ oddsData, marketKey, player, line, side, bookmakerOdds, isH2h = false }) {
  if (!oddsData?.bookmakers?.length || !(bookmakerOdds > 1)) return null;

  const pinnacleBm = oddsData.bookmakers.find(b => b.key === 'pinnacle');
  if (pinnacleBm) {
    const p = fairProbFromMarket(pinnacleBm.markets?.find(m => m.key === marketKey), player, line, side, isH2h);
    if (p > 0) {
      return { clv: parseFloat(((bookmakerOdds * p - 1) * 100).toFixed(2)), source: 'pinnacle', nCasas: 1 };
    }
  }

  const probs = [];
  for (const bm of oddsData.bookmakers) {
    if (bm.key === 'pinnacle') continue; // já tentada isolada acima
    const p = fairProbFromMarket(bm.markets?.find(m => m.key === marketKey), player, line, side, isH2h);
    if (p > 0) probs.push(p);
  }
  if (!probs.length) return null;
  const media = probs.reduce((a, b) => a + b, 0) / probs.length;
  return { clv: parseFloat(((bookmakerOdds * media - 1) * 100).toFixed(2)), source: 'consensus_us', nCasas: probs.length };
}

module.exports = {
  devigTwoWay,
  movementDirection,
  adjustedClosingProbability,
  adjustedClv,
  noVigClosingClv,
};
