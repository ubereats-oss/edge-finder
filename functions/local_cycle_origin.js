const legacy = require('./local_cycle_origins.json');
function cycleOrigin(cycle) {
  if (['scheduler', 'manual', 'test'].includes(cycle.executionOrigin)) return cycle.executionOrigin;
  const origin = legacy[cycle.startedAt]?.origin;
  return ['scheduler', 'manual', 'test'].includes(origin) ? origin : 'scheduler';
}
module.exports = { cycleOrigin };
