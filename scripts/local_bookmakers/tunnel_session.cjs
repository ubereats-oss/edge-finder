const fs = require('node:fs');
const path = require('node:path');
function createSession({ root, id, call, now = () => new Date().toISOString() }) {
  const folder = path.join(root, '.local_logs/betano');
  const ownership = path.join(folder, 'vpn-ownership.json');
  const observations = path.join(folder, 'vpn-state-observations.json');
  const notifications = path.join(folder, 'tunnelbear-notification-state.json');
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw Error('VPN_OWNERSHIP_UNCONFIRMED: registro ilegível; conexão preservada.');
  } };
  const save = (file, value) => { fs.mkdirSync(folder, { recursive: true }); const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file); };
  const userProgram = check => (check.programs || []).some(p => p.Desktop !== 'EdgeFinderCollection');
  function loginFailure(message) {
    if (/TUNNELBEAR_LOGIN_REQUIRED|TunnelBear pede login/i.test(message)) save(notifications, {
      ...read(notifications), pendingLogin: { code: 'LoginRequired', category: 'TunnelBear pede login', originalError: 'TUNNELBEAR_LOGIN_REQUIRED' },
    });
  }
  function connected(result) {
    if (result.status === 'connected' || result.nativeStatus === 'Connected') save(notifications, {
      ...read(notifications), pendingLogin: null, lastSuccessfulConnectionAt: now(),
    });
    return result;
  }
  function historicalCount() {
    let count = 0;
    try {
      const files = fs.readdirSync(folder).filter(n => /^cycle-.*\.json$/.test(n)).sort().reverse().slice(0, 2);
      for (const file of files) {
        const cycle = read(path.join(folder, file)), check = cycle.tunnelBearProgram;
        if (!check || check.nativeStatus !== 'Connecting' || check.nativeCountry || userProgram(check) || cycle.vpnPreservedForUser) break;
        count++;
      }
    } catch { /* No history is not evidence of two cycles. */ }
    return count;
  }
  function observe(check) {
    let own = read(ownership), previous = read(observations);
    if (check.nativeStatus === 'Connected' || (check.nativeStatus !== 'Disconnected' && userProgram(check))) {
      own = { owner: 'alex', observedAt: now(), nativeStatus: check.nativeStatus, nativeCountry: check.nativeCountry };
      save(ownership, own);
    } else if (check.nativeStatus === 'Disconnected' && own.owner === 'alex') { own = {}; save(ownership, own); }
    const candidate = check.nativeStatus === 'Connecting' && !check.nativeCountry && !userProgram(check) && own.owner !== 'alex';
    const count = candidate ? (previous.id === id ? previous.count || 1 : (previous.count ?? historicalCount()) + 1) : 0;
    save(observations, { id, count, observedAt: now(), nativeStatus: check.nativeStatus, nativeCountry: check.nativeCountry });
    return { ...check, consecutiveConnecting: count, decision: candidate && count >= 2 ? 'recover_owned' : check.decision };
  }
  function claim(check) {
    if (userProgram(check) && check.nativeStatus !== 'Disconnected') throw Error('VPN do Alex preservado; estado incerto.');
    save(ownership, { owner: 'routine', id, intentAt: now(), nativeBefore: check.nativeStatus, programsBefore: check.programs || [], cleanupErrors: [] });
  }
  function cleanup() {
    let own = read(ownership);
    if (own.owner !== 'routine') return { action: 'cleanup-owned', owned: false, preservedForUser: own.owner === 'alex' };
    const check = call('program-check');
    if (userProgram(check) || (check.nativeStatus === 'Connected' && check.nativeCountry !== 'PT') ||
        (check.nativeStatus === 'Connected' && !(check.programs || []).some(p => p.Desktop === 'EdgeFinderCollection'))) {
      save(ownership, { ...own, owner: 'alex', preservedAt: now() });
      return { action: 'cleanup-owned', owned: false, preservedForUser: true };
    }
    const result = { action: 'cleanup-owned', owned: true, cleanupErrors: [] };
    const currentState = call('state');
    if (!(check.programs || []).length && own.cleanupAt && currentState.status === 'Down') {
      return { ...result, state: currentState, disconnected: currentState.nativeStatus === 'Disconnected',
        cleanupErrors: own.cleanupErrors || [], alreadyClosed: true };
    }
    try { if (call('state').nativeStatus !== 'Disconnected') result.disconnect = call('disconnect'); }
    catch (error) { result.cleanupErrors.push(error.message); loginFailure(error.message); }
    try { result.close = call('program-close-owned'); }
    catch (error) { result.cleanupErrors.push(error.message); }
    result.state = call('state');
    result.disconnected = result.state.nativeStatus === 'Disconnected';
    save(ownership, { ...own, owner: result.disconnected && !result.cleanupErrors.length ? null : 'routine', cleanupAt: now(), cleanupErrors: result.cleanupErrors, finalState: result.state });
    return result;
  }
  function run(action) {
    if (action === 'program-check') return observe(call(action));
    if (action === 'cleanup-owned') return cleanup();
    if (action === 'connect') {
      let check = observe(call('program-check'));
      if (check.decision === 'preserve' || check.decision === 'other_country') return connected(call('connect'));
      if (check.decision === 'recover_owned') {
        claim(check);
        const recovered = cleanup();
        if (!recovered.disconnected) throw Error(recovered.cleanupErrors.find(x => /TUNNELBEAR_LOGIN_REQUIRED/.test(x)) || recovered.cleanupErrors[0] || 'VPN_STATE_UNCONFIRMED: recuperação própria sem Disconnected');
        check = observe(call('program-check'));
      }
      if (check.nativeStatus !== 'Disconnected') return call('connect');
      // Persist intent before the UI or connection can be opened, including throws.
      claim(check);
      try {
        const result = call('connect');
        if (!result.connectedByCycle) save(ownership, { owner: 'alex', observedAt: now() });
        return connected(result);
      } catch (primary) {
        loginFailure(primary.message);
        try { primary.cleanup = cleanup(); } catch (error) { primary.cleanupError = error.message; }
        throw primary;
      }
    }
    if (['disconnect', 'program-close'].includes(action) && read(ownership).owner === 'alex') throw Error('VPN do Alex preservado; limpeza não autorizada.');
    const result = call(action);
    if (action === 'program-close' && read(ownership).owner === 'routine' && call('state').nativeStatus === 'Disconnected') save(ownership, { ...read(ownership), owner: null, closedAt: now() });
    return result;
  }
  return { run, cleanup, observe };
}
module.exports = { createSession };
