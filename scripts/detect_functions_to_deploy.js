const changedFiles = process.argv.slice(2);

const affected = new Set();

for (const file of changedFiles) {
  if (!file.startsWith('functions/')) continue;

  if (['functions/edge_health.js', 'functions/observation_health.js'].includes(file)) {
    affected.add('dailyEdgeFinderHealth');
    continue;
  }

  if (file === 'functions/odds_api_monthly_budget.js') {
    // retryDailyEdgeFinderHealth só reenvia relatórios/alertas já persistidos;
    // não consulta nem reserva créditos. Não requer atualização de Cloud Tasks.
    for (const name of ['closingOddsScheduler', 'compareLocalBookmakerRead',
      'dailyEdgeFinderHealth', 'notifyOddsApiExternalUse', 'notifyPlacardOpportunity',
      'revalidatePlacardOpportunities', 'syncOddsBr']) affected.add(name);
    continue;
  }

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
