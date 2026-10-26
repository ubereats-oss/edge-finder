const { RETENTION_MS, expireStateLines } = require('./tunnelbear_states');

async function pruneCloudStateLines(db, now = Date.now()) {
  const cutoff = new Date(now - RETENTION_MS).toISOString();
  // Run from the existing daily health handler. Metadata/categories survive.
  for (const [collection, field] of [['_local_cycle_health', 'startedAt'], ['_edge_budget_alerts', 'stateLinesAt']]) {
    let cursor;
    for (;;) {
      let query = db.collection(collection).where(field, '<', cutoff).orderBy(field).limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (!page.docs.length) break;
      for (const doc of page.docs) {
        const row = doc.data();
        if (collection === '_local_cycle_health' && (row.tunnelBear?.stateLines?.length || row.tunnelBear?.nativeFailures?.length)) {
          const lines = expireStateLines(row.tunnelBear, now).stateLines || [];
          const failures = (row.tunnelBear.nativeFailures || []).filter(line => Date.parse(line.at) >= now - RETENTION_MS);
          if (lines.length !== (row.tunnelBear.stateLines || []).length || failures.length !== (row.tunnelBear.nativeFailures || []).length)
            await doc.ref.update({ 'tunnelBear.stateLines': lines, 'tunnelBear.nativeFailures': failures });
        }
        if (collection === '_edge_budget_alerts' && row.text?.includes('\n')) {
          const [heading, ...lines] = row.text.split('\n');
          const text = [heading, ...lines.filter(line => Date.parse(line.slice(0, 24)) >= now - RETENTION_MS)].join('\n');
          if (text !== row.text) await doc.ref.update({ text });
        }
      }
      if (page.docs.length < 200) break;
      cursor = page.docs.at(-1);
    }
  }
  const budgets = await db.collection('_odds_api_budget').where('vpn.observedAt', '<', cutoff).get();
  for (const doc of budgets.docs) {
    const diagnostic = doc.data().vpn?.tunnelBear;
    if (diagnostic?.stateLines?.length || diagnostic?.nativeFailures?.length) {
      const lines = expireStateLines(diagnostic, now).stateLines || [];
      const failures = (diagnostic.nativeFailures || []).filter(line => Date.parse(line.at) >= now - RETENTION_MS);
      if (lines.length !== (diagnostic.stateLines || []).length || failures.length !== (diagnostic.nativeFailures || []).length)
        await doc.ref.update({ 'vpn.tunnelBear.stateLines': lines, 'vpn.tunnelBear.nativeFailures': failures });
    }
  }
}
module.exports = { pruneCloudStateLines };
