// Funções de data trabalhando sempre com 'AAAA-MM-DD' no fuso configurado
const TZ = process.env.TZ_APP || 'America/Cuiaba';

function hoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function somarDias(dataISO, dias) {
  const d = new Date(dataISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(dias));
  return d.toISOString().slice(0, 10);
}

function diasEntre(deISO, ateISO) {
  const a = new Date(deISO + 'T12:00:00Z');
  const b = new Date(ateISO + 'T12:00:00Z');
  return Math.round((b - a) / 86400000);
}

function formatarBR(dataISO) {
  const [a, m, d] = dataISO.split('-');
  return `${d}/${m}/${a}`;
}

function dataValida(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00Z'));
}

module.exports = { TZ, hoje, somarDias, diasEntre, formatarBR, dataValida };
