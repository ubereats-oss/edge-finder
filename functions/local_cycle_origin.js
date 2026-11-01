const legacy = require('./local_cycle_origins.json');
function cycleOrigin(cycle) {
  const origin = cycle.executionOrigin || legacy[cycle.startedAt]?.origin;
  return ['scheduler', 'manual', 'test'].includes(origin) ? origin : 'unknown';
}
module.exports = { cycleOrigin };
