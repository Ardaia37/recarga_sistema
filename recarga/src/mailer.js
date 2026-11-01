// Envio de e-mail via SMTP (Gmail, Outlook, Hostinger, Zoho, etc.)
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP não configurado. Preencha SMTP_HOST, SMTP_USER e SMTP_PASS no arquivo .env');
  }
  const port = Number(SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

async function enviarEmail({ assunto, html, texto }) {
  const para = process.env.EMAIL_DESTINO || process.env.SMTP_USER;
  const de = process.env.EMAIL_REMETENTE || `Controle de Recargas <${process.env.SMTP_USER}>`;
  return getTransporter().sendMail({ from: de, to: para, subject: assunto, html, text: texto });
}

module.exports = { enviarEmail };
