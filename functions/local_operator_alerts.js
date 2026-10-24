const actions = {
  login: 'Abra o TunnelBear e faça login na sua conta; deixe o programa aberto. Não é necessário ligar o VPN.',
  subscription: 'Abra o TunnelBear e regularize a assinatura ou selecione uma conta/plano com acesso ativo; depois deixe o programa aberto. A coleta não fará compras.',
  data: 'Abra o TunnelBear e confira a franquia: os dados acabaram. Aguarde a renovação ou disponibilize franquia válida antes de retomar; a coleta não comprará dados.',
  update: 'Abra o TunnelBear, conclua a atualização obrigatória e reabra o programa; deixe o VPN desligado para a próxima coleta.',
};
function operatorIssue(error = '') {
  if (/TUNNELBEAR_DATA_EXHAUSTED|out of (free )?data|franquia.*(?:acab|esgot)/i.test(error)) return 'data';
  if (/TUNNELBEAR_LOGIN_REQUIRED|log[ -]?in|sign[ -]?in|entrar na conta/i.test(error)) return 'login';
  if (/TUNNELBEAR_UPDATE_REQUIRED|mandatory|required update|update required|atualiza.*obrigat/i.test(error)) return 'update';
  if (/TUNNELBEAR_SUBSCRIPTION_REQUIRED|subscription.*(?:expired|required)|assinatura.*(?:expir|vencid)/i.test(error)) return 'subscription';
  return null;
}
module.exports = { actions, operatorIssue };
