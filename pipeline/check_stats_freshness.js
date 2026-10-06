const fs = require('fs');

const CONFIG = {
  nba: { label: 'NBA', file: 'nba_player_stats.json', maxAgeDays: 3 },
  mlb: { label: 'MLB', file: 'mlb_player_stats.json', maxAgeDays: 3 },
  nhl: { label: 'NHL', file: 'nhl_player_stats.json', maxAgeDays: 3, backfillMonths: 35 },
  nfl: { label: 'NFL', file: 'nfl_player_stats.json', maxAgeDays: 8 },
};

function parseGameDate(value) {
  if (typeof value !== 'string') return null;

  let normalized = value.trim();
  if (/^\d{8}$/.test(normalized)) {
    normalized = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}T00:00:00Z`;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function walkDates(value, dates) {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) walkDates(item, dates);
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'date' || key === '_eventDate') {
      const parsed = parseGameDate(nested);
      if (parsed) dates.push(parsed);
    }
    walkDates(nested, dates);
  }
}

function dateOnlyUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function main() {
  const sport = process.argv[2];
  const config = CONFIG[sport];
  if (!config) {
    console.error(`ERRO: esporte inválido para verificação de frescor: ${sport || '(vazio)'}.`);
    process.exit(1);
  }

  if (!fs.existsSync(config.file)) {
    console.error(`ERRO: stats ${config.label} ausentes (${config.file}).`);
    process.exit(1);
  }

  let stats;
  try {
    stats = JSON.parse(fs.readFileSync(config.file, 'utf8'));
  } catch (err) {
    console.error(`ERRO: stats ${config.label} inválidos (${config.file}): ${err.message}`);
    process.exit(1);
  }

  const dates = [];
  walkDates(stats, dates);

  if (!dates.length) {
    console.error(`ERRO: stats ${config.label} sem data de jogo em ${config.file}.`);
    process.exit(1);
  }

  let latest = dates[0];
  for (const date of dates) {
    if (date > latest) latest = date;
  }
  const latestDay = dateOnlyUtc(latest);
  const today = dateOnlyUtc(new Date());
  const ageDays = Math.floor((today - latestDay) / 86400000);
  const latestIsoDate = latestDay.toISOString().slice(0, 10);

  const backfillDone = stats.__meta?.backfillMonthsCompleted;
  if (sport === 'nhl' && Number.isInteger(backfillDone) && backfillDone < config.backfillMonths) {
    console.warn(`AVISO: stats ${config.label} em backfill (${backfillDone}/${config.backfillMonths} períodos). Último jogo nos dados: ${latestIsoDate}. Frescor não bloqueia esta execução.`);
    return;
  }

  if (ageDays > config.maxAgeDays) {
    console.error(`ERRO: stats ${config.label} atrasados. Último jogo nos dados: ${latestIsoDate}. Limite: ${config.maxAgeDays} dia(s). Atraso atual: ${ageDays} dia(s).`);
    process.exit(1);
  }

  console.log(`Stats ${config.label} OK. Último jogo nos dados: ${latestIsoDate}. Atraso: ${ageDays} dia(s).`);
}

main();
