const fs = require('node:fs');
const path = require('node:path');
const safe = require('./safe_files.cjs');

function createSession({ root, id, call, now = () => new Date().toISOString() }) {
  const folder = path.join(root, '.local_logs/betano');
  const ownership = path.join(folder, 'vpn-ownership.json');
  const notifications = path.join(folder, 'tunnelbear-notification-state.json');
  const read = file => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return {};
      throw Error('VPN_OWNERSHIP_UNCONFIRMED: registro ilegível; conexão preservada.');
    }
  };
  const save = (file, value) => { fs.mkdirSync(folder, { recursive: true }); safe.atomic(file, JSON.stringify(value, null, 2)); };
  const userProgram = check => (check.programs || []).some(p => p.Desktop !== 'EdgeFinderCollection');
  const ownedProgram = (check, own) => own.owner === 'routine' && (check.programs || []).some(p =>
    p.Desktop === 'EdgeFinderCollection' && p.Installed && Date.parse(p.StartedAt) >= Date.parse(own.intentAt));
  function loginFailure(message) {
    if (!/TUNNELBEAR_LOGIN_REQUIRED|TunnelBear pede login/i.test(message)) return;
    save(notifications, { ...read(notifications), pendingLogin: {
      code: 'LoginRequired', category: 'TunnelBear pede login', originalError: 'TUNNELBEAR_LOGIN_REQUIRED',
    } });
    const own = read(ownership);
    if (own.owner === 'routine' && own.id === id) save(ownership, { ...own, loginRequired: true });
  }
  function connected(result) {
    if (result.status === 'connected' || result.nativeStatus === 'Connected') {
      save(notifications, { ...read(notifications), pendingLogin: null, lastSuccessfulConnectionAt: now() });
      const own = read(ownership);
      if (own.owner === 'routine') save(ownership, { ...own, connectionEstablished: true });
    }
    return result;
  }
  function observe(check) {
    const own = read(ownership);
    if (!userProgram(check) && ownedProgram(check, own) && own.id !== id) return { ...check, decision: 'owned_cleanup_required' };
    if (check.nativeStatus === 'Connected' || (check.nativeStatus !== 'Disconnected' && userProgram(check))) {
      save(ownership, { owner: 'alex', observedAt: now(), nativeStatus: check.nativeStatus, nativeCountry: check.nativeCountry });
    } else if ((check.nativeStatus === 'Disconnected' || check.staleIntermediateAccepted) && own.owner === 'alex') {
      save(ownership, { owner: null, clearedAt: now(), reason: check.staleIntermediateAccepted ? 'stale_intermediate_no_program_adapter_down' : 'native_disconnected' });
    }
    return check;
  }
  function claim(check) {
    if (check.decision !== 'collect') throw Error('VPN_OWNERSHIP_UNCONFIRMED: tentativa sem decisão segura de coleta.');
    save(ownership, { owner: 'routine', id, intentAt: now(), nativeBefore: check.nativeStatus,
      nativeAt: check.nativeAt, staleIntermediateAccepted: check.staleIntermediateAccepted === true,
      programsBefore: check.programs || [], cleanupErrors: [] });
  }
  function cleanup() {
    const own = read(ownership);
    if (own.owner !== 'routine') return { action: 'cleanup-owned', owned: false, preservedForUser: own.owner === 'alex' };
    const check = call('program-check');
    if (userProgram(check) || (check.nativeStatus === 'Connected' &&
        (check.nativeCountry !== 'PT' || !(check.programs || []).some(p => p.Desktop === 'EdgeFinderCollection')))) {
      save(ownership, { ...own, owner: 'alex', preservedAt: now() });
      return { action: 'cleanup-owned', owned: false, preservedForUser: true };
    }
    const result = { action: 'cleanup-owned', owned: true, cleanupErrors: [] };
    const state = call('state');
    const noProgram = !(check.programs || []).length;
    const alreadyOff = state.nativeStatus === 'Disconnected' || (noProgram && check.staleIntermediateAccepted && state.status === 'Down');
    const alreadyClosed = noProgram && own.cleanupAt && state.status === 'Down';
    if (!alreadyOff && !alreadyClosed && !(own.loginRequired && state.status === 'Down')) {
      try { result.disconnect = call('disconnect'); }
      catch (error) { result.cleanupErrors.push(error.message); loginFailure(error.message); }
    } else if (alreadyClosed) result.cleanupErrors = own.cleanupErrors || [];
    try { result.close = call('program-close-owned'); }
    catch (error) { result.cleanupErrors.push(error.message); }
    result.state = call('state');
    result.disconnected = result.state.nativeStatus === 'Disconnected' || (noProgram && check.staleIntermediateAccepted && result.state.status === 'Down');
    result.physicallyDisconnected = result.state.status === 'Down';
    const remaining = call('program-check').programs || [];
    save(ownership, { ...read(ownership), owner: result.physicallyDisconnected && !remaining.length ? null : 'routine',
      cleanupAt: now(), cleanupErrors: result.cleanupErrors, finalState: result.state, remainingPrograms: remaining });
    return result;
  }
  function run(action) {
    if (action === 'program-check') return observe(call(action));
    if (action === 'cleanup-owned') return cleanup();
    if (action === 'connect') {
      let check = observe(call('program-check'));
      if (check.decision === 'owned_cleanup_required') {
        const cleaned = cleanup();
        if (!cleaned.physicallyDisconnected || cleaned.cleanupErrors.length) throw Error(cleaned.cleanupErrors[0] || 'Limpeza da conexão própria anterior não confirmada.');
        check = observe(call('program-check'));
      }
      if (check.decision !== 'collect') return connected(call('connect'));
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
    let result;
    try { result = call(action); } catch (error) { loginFailure(error.message); throw error; }
    if (action === 'program-close' && read(ownership).owner === 'routine' && call('state').nativeStatus === 'Disconnected') save(ownership, { ...read(ownership), owner: null, closedAt: now() });
    return result;
  }
  return { run, cleanup, observe };
}
module.exports = { createSession };
