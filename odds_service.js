const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    type: 'atp',
    date: null,
    mainOnly: true,
    output: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--type' && args[i + 1]) {
      config.type = args[i + 1].toLowerCase();
      i++;
      continue;
    }

    if (arg === '--date' && args[i + 1]) {
      config.date = args[i + 1];
      i++;
      continue;
    }

    if (arg === '--output' && args[i + 1]) {
      config.output = args[i + 1];
      i++;
      continue;
    }

    if (arg === '--all-levels') {
      config.mainOnly = false;
    }
  }

  if (!['atp', 'wta'].includes(config.type)) {
    throw new Error('Use --type atp ou --type wta');
  }

  return config;
}

function buildUrl(type, date) {
  let url = `https://www.tennisexplorer.com/matches/?type=${type}-single`;

  if (date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

    if (!match) {
      throw new Error('Use --date no formato YYYY-MM-DD');
    }

    const [, year, month, day] = match;
    url += `&year=${year}&month=${month}&day=${day}`;
  }

  return url;
}

function shouldSkipTournament(name) {
  const lower = name.toLowerCase();
  const lowerTierTerms = ['itf', 'futures', 'utr', 'exhibition'];

  return lowerTierTerms.some(term => lower.includes(term));
}

function extractTime(text) {
  const match = text.match(/\d{2}:\d{2}/);
  return match ? match[0] : '';
}

function extractOdds(row) {
  const oddsTds = row.find('td.course, td.coursew').toArray();

  const validOdds = oddsTds
    .map(td => cheerio.load(td).text().trim())
    .filter(value => value && value !== '\xa0');

  let odd1 = null;
  let odd2 = null;

  if (validOdds.length >= 2) {
    odd1 = Number(validOdds[0]);
    odd2 = Number(validOdds[1]);

    if (Number.isNaN(odd1)) odd1 = validOdds[0];
    if (Number.isNaN(odd2)) odd2 = validOdds[1];
  }

  return { odd1, odd2 };
}

function extractInfoUrl(row) {
  const href =
    row.find('a[href*="/match-detail/?id="]').attr('href') || null;

  if (!href) {
    return null;
  }

  if (href.startsWith('http')) {
    return href;
  }

  return `https://www.tennisexplorer.com${href}`;
}

async function scrapeMatches() {
  const config = parseArgs();
  const url = buildUrl(config.type, config.date);
  const output =
    config.output ||
    `${config.type}_matches_${config.date || new Date().toISOString().slice(0, 10)}.json`;

  console.log('[1] URL:', url);
  console.log('[2] mainOnly:', config.mainOnly);
  console.log('[3] output:', output);

  const response = await axios.get(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 30000
  });

  console.log('[4] HTTP:', response.status);

  const $ = cheerio.load(response.data);
  const tables = $('table.result').toArray();

  console.log('[5] tables.result:', tables.length);

  const matches = [];

  for (const tableEl of tables) {
    const table = $(tableEl);
    const rows = table.find('tr').toArray();

    let currentTournament = 'Unknown';
    let skipTournament = false;

    for (let i = 0; i < rows.length; i++) {
      const row = $(rows[i]);
      const rowId = row.attr('id') || '';
      const classes = (row.attr('class') || '').split(/\s+/).filter(Boolean);

      if (classes.includes('head') && classes.includes('flags')) {
        const tournamentName = row.find('td.t-name').text().trim();

        if (tournamentName) {
          currentTournament = tournamentName;
          skipTournament = config.mainOnly && shouldSkipTournament(currentTournament);
        }

        continue;
      }

      if (skipTournament) {
        continue;
      }

      if (!rowId) {
        continue;
      }

      const isFirstRow =
        !rowId.endsWith('b') &&
        (classes.includes('one') || classes.includes('two'));

      if (!isFirstRow) {
        continue;
      }

      const player1 = row.find('td.t-name').first().text().trim() || 'Unknown';
      const matchTime = extractTime(row.find('td.time').text());
      const { odd1, odd2 } = extractOdds(row);
      const infoUrl = extractInfoUrl(row);

      let player2 = 'Unknown';

      if (i + 1 < rows.length) {
        const nextRow = $(rows[i + 1]);
        const nextRowId = nextRow.attr('id') || '';

        if (nextRowId === `${rowId}b`) {
          player2 = nextRow.find('td.t-name').first().text().trim() || 'Unknown';
          i++;
        }
      }

      matches.push({
        tournament: currentTournament,
        time: matchTime,
        player1,
        player2,
        odds1: odd1,
        odds2: odd2,
        infoUrl
      });
    }
  }

  fs.writeFileSync(output, JSON.stringify(matches, null, 2), 'utf8');

  console.log('[6] matches:', matches.length);

  matches.slice(0, 10).forEach((match, index) => {
    console.log(
      `[7] ${index + 1}: ${match.tournament} | ${match.time} | ${match.player1} x ${match.player2} | ${match.odds1} / ${match.odds2}`
    );
  });

  console.log('[8] arquivo salvo');
}

scrapeMatches().catch(error => {
  console.error('[ERRO]', error.message);
  process.exit(1);
});
