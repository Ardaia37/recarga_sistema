// Verifica vencimentos e envia UM e-mail diário com tudo o que precisa de atenção
const cron = require('node-cron');
const db = require('./db');
const { enviarEmail } = require('./mailer');
const { listarNumerosComStatus, DIAS_AVISO } = require('./status');
const { TZ, formatarBR } = require('./datas');

function formatarNumero(n) {
  const d = n.numero;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

// Decide qual aviso cabe para cada número hoje (só olha a última recarga)
function avisosPendentes() {
  const jaEnviado = db.prepare('SELECT 1 FROM avisos WHERE recarga_id = ? AND tipo = ?');
  const pendentes = [];

  for (const n of listarNumerosComStatus()) {
    if (!n.ultima_recarga) continue;
    const dias = n.dias_restantes;
    let tipo = null;
    if (dias < 0) tipo = 'vencido';
    else if (dias === 0) tipo = 'hoje';
    else if (dias <= DIAS_AVISO()) tipo = 'antes';
    if (!tipo) continue;
    if (jaEnviado.get(n.ultima_recarga.id, tipo)) continue;
    pendentes.push({ ...n, tipo });
  }
  return pendentes;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function montarEmail(itens) {
  const rotulo = { vencido: 'VENCIDO', hoje: 'VENCE HOJE', antes: 'Vence em breve' };
  const cor = { vencido: '#c0392b', hoje: '#d35400', antes: '#b7950b' };
  const ordem = { vencido: 0, hoje: 1, antes: 2 };
  itens.sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || a.dias_restantes - b.dias_restantes);

  const descDias = (i) =>
    i.dias_restantes < 0 ? `venceu há ${-i.dias_restantes} dia(s)`
      : i.dias_restantes === 0 ? 'vence hoje'
      : `faltam ${i.dias_restantes} dia(s)`;

  const linhasHtml = itens.map((i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee"><strong>${esc(i.apelido || '-')}</strong><br>${formatarNumero(i)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(i.operadora)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${formatarBR(i.ultima_recarga.vencimento)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;color:${cor[i.tipo]};font-weight:bold">${rotulo[i.tipo]}<br><span style="font-weight:normal">${descDias(i)}</span></td>
    </tr>`).join('');

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
    <h2 style="margin-bottom:4px">📱 Aviso de recargas</h2>
    <p style="color:#555;margin-top:0">${itens.length} número(s) precisam de atenção.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="background:#f4f4f4;text-align:left">
        <th style="padding:8px">Número</th><th style="padding:8px">Operadora</th>
        <th style="padding:8px">Vencimento</th><th style="padding:8px">Situação</th>
      </tr>
      ${linhasHtml}
    </table>
    ${process.env.APP_URL ? `<p><a href="${process.env.APP_URL}">Abrir o painel</a></p>` : ''}
  </div>`;

  const texto = itens.map((i) =>
    `${rotulo[i.tipo]} - ${i.apelido || ''} ${formatarNumero(i)} (${i.operadora}) - vencimento ${formatarBR(i.ultima_recarga.vencimento)} - ${descDias(i)}`
  ).join('\n');

  const temVencido = itens.some((i) => i.tipo !== 'antes');
  const assunto = temVencido
    ? `⚠️ Recarga vencendo/vencida: ${itens.length} número(s)`
    : `📱 Recarga vence em breve: ${itens.length} número(s)`;

  return { assunto, html, texto };
}

async function verificarEEnviar() {
  const itens = avisosPendentes();
  if (itens.length === 0) {
    console.log(`[avisos] ${new Date().toISOString()} nada a avisar`);
    return { enviados: 0 };
  }
  await enviarEmail(montarEmail(itens));

  const registrar = db.prepare('INSERT OR IGNORE INTO avisos (recarga_id, tipo) VALUES (?, ?)');
  for (const i of itens) registrar.run(i.ultima_recarga.id, i.tipo);

  console.log(`[avisos] e-mail enviado com ${itens.length} número(s)`);
  return { enviados: itens.length };
}

function iniciarAgendamento() {
  const expr = process.env.HORARIO_CRON || '0 8 * * *'; // todo dia às 08:00
  cron.schedule(expr, () => {
    verificarEEnviar().catch((e) => console.error('[avisos] erro:', e.message));
  }, { timezone: TZ });
  console.log(`[avisos] agendado (${expr}, fuso ${TZ})`);
}

module.exports = { iniciarAgendamento, verificarEEnviar, avisosPendentes, montarEmail };
