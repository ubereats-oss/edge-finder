function runTunnel(action, invoke, alreadyRestarted = () => false) {
  const guarded = ['connect', 'prepare'].includes(action);
  const initial = guarded ? invoke('state') : null;
  if (guarded && (initial.status !== 0 || !initial.stdout)) throw new Error('Estado inicial do VPN indisponível; nenhum reinício autorizado.');
  const result = invoke(action);
  if (result.error?.code !== 'ETIMEDOUT' || !guarded) return result;
  const state = JSON.parse(initial.stdout);
  if (state.nativeStatus === 'Connected' || (state.status !== 'Down' && state.nativeStatus !== 'Disconnected'))
    throw new Error('TunnelBear travado; VPN preexistente do Alex preservado, ciclo sem conexão.');
  if (alreadyRestarted()) throw new Error('TunnelBear travou após reinício; segunda reabertura proibida.');
  const recovery = invoke('recover');
  if (recovery.status !== 0) return recovery;
  return invoke(action, true);
}
module.exports = { runTunnel };
