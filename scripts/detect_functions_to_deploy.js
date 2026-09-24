const changedFiles = process.argv.slice(2);

const affected = new Set();

for (const file of changedFiles) {
  if (!file.startsWith('functions/')) continue;

  if (file === 'functions/closing_odds_rules.js') {
    affected.add('closingOddsScheduler');
    continue;
  }

  if (file === 'functions/risk_config.js') {
    affected.add('syncOddsBr');
    continue;
  }

  if (
    file === 'functions/index.js' ||
    file === 'functions/package.json' ||
    file === 'functions/package-lock.json'
  ) {
    affected.add('closingOddsScheduler');
    affected.add('syncOddsBr');
    continue;
  }
}

const functions = [...affected].sort();
console.log(functions.join(','));
