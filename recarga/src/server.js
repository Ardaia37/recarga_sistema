require('dotenv').config({ quiet: true });
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const db = require('./db');
const { listarNumerosComStatus, DIAS_AVISO } = require('./status');
const { iniciarAgendamento, verificarEEnviar } = require('./avisos');
const { enviarEmail } = require('./mailer');
const { hoje, somarDias, dataValida } = require('./datas');

const app = express();
app.use(express.json());

// ---------- Login simples (uma senha, definida no .env) ----------
const SENHA = process.env.APP_SENHA;
const SEGREDO = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DURACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function criarToken() {
  const exp = Date.now() + DURACAO_MS;
  const sig = crypto.createHmac('sha256', SEGREDO).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}
function tokenValido(t) {
  if (!t || !t.includes('.')) return false;
  const [exp, sig] = t.split('.');
  if (Number(exp) < Date.now()) return false;
  const esperado = crypto.createHmac('sha256', SEGREDO).update(exp).digest('hex');
  return sig.length === esperado.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado));
}
function lerCookie(req, nome) {
  const c = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(nome + '='));
  return c ? decodeURIComponent(c.slice(nome.length + 1)) : null;
}

app.post('/api/login', (req, res) => {
  if (!SENHA) return res.status(500).json({ erro: 'Defina APP_SENHA no arquivo .env' });
  const enviada = String(req.body?.senha || '');
  const ok = enviada.length === SENHA.length &&
    crypto.timingSafeEqual(Buffer.from(enviada), Buffer.from(SENHA));
  if (!ok) return setTimeout(() => res.status(401).json({ erro: 'Senha incorreta' }), 800);
  const seguro = process.env.COOKIE_SEGURO === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sessao=${criarToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACAO_MS / 1000}${seguro}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sessao=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (tokenValido(lerCookie(req, 'sessao'))) return next();
  res.status(401).json({ erro: 'Não autenticado' });
});

// ---------- Validação ----------
function limparNumero(s) {
  return String(s || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
}
function validarRecarga(b) {
  const data = b.data || hoje();
  const valor = Number(String(b.valor ?? '').replace(',', '.'));
  const validade = parseInt(b.validade_dias, 10);
  if (!dataValida(data)) return { erro: 'Data da recarga inválida' };
  if (!(valor > 0)) return { erro: 'Valor da recarga inválido' };
  if (!(validade > 0 && validade <= 365)) return { erro: 'Validade deve ser entre 1 e 365 dias' };
  return { data, valor, validade_dias: validade, vencimento: somarDias(data, validade) };
}
const inserirRecarga = db.prepare(
  'INSERT INTO recargas (numero_id, data, valor, validade_dias, vencimento) VALUES (?, ?, ?, ?, ?)'
);

// ---------- Rotas ----------
app.get('/api/config', (req, res) => {
  res.json({ dias_aviso: DIAS_AVISO(), hoje: hoje(), email_destino: process.env.EMAIL_DESTINO || process.env.SMTP_USER || '' });
});

app.get('/api/numeros', (req, res) => res.json(listarNumerosComStatus()));

app.post('/api/numeros', (req, res) => {
  const numero = limparNumero(req.body.numero);
  const operadora = String(req.body.operadora || '').trim();
  const apelido = String(req.body.apelido || '').trim() || null;
  if (numero.length < 10 || numero.length > 11) return res.status(400).json({ erro: 'Informe o número com DDD (10 ou 11 dígitos)' });
  if (!operadora) return res.status(400).json({ erro: 'Informe a operadora' });

  let recarga = null;
  if (req.body.recarga) {
    recarga = validarRecarga(req.body.recarga);
    if (recarga.erro) return res.status(400).json(recarga);
  }

  try {
    db.exec('BEGIN');
    const r = db.prepare('INSERT INTO numeros (numero, ddd, operadora, apelido) VALUES (?, ?, ?, ?)')
      .run(numero, numero.slice(0, 2), operadora, apelido);
    if (recarga) inserirRecarga.run(r.lastInsertRowid, recarga.data, recarga.valor, recarga.validade_dias, recarga.vencimento);
    db.exec('COMMIT');
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) {
    db.exec('ROLLBACK');
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ erro: 'Esse número já está cadastrado' });
    throw e;
  }
});

app.put('/api/numeros/:id', (req, res) => {
  const numero = limparNumero(req.body.numero);
  const operadora = String(req.body.operadora || '').trim();
  const apelido = String(req.body.apelido || '').trim() || null;
  if (numero.length < 10 || numero.length > 11) return res.status(400).json({ erro: 'Informe o número com DDD (10 ou 11 dígitos)' });
  if (!operadora) return res.status(400).json({ erro: 'Informe a operadora' });
  try {
    const r = db.prepare('UPDATE numeros SET numero = ?, ddd = ?, operadora = ?, apelido = ? WHERE id = ?')
      .run(numero, numero.slice(0, 2), operadora, apelido, req.params.id);
    if (!r.changes) return res.status(404).json({ erro: 'Número não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ erro: 'Esse número já está cadastrado' });
    throw e;
  }
});

app.delete('/api/numeros/:id', (req, res) => {
  const r = db.prepare('DELETE FROM numeros WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Número não encontrado' });
  res.json({ ok: true });
});

app.get('/api/numeros/:id/recargas', (req, res) => {
  res.json(db.prepare('SELECT * FROM recargas WHERE numero_id = ? ORDER BY data DESC, id DESC').all(req.params.id));
});

app.post('/api/numeros/:id/recargas', (req, res) => {
  const existe = db.prepare('SELECT id FROM numeros WHERE id = ?').get(req.params.id);
  if (!existe) return res.status(404).json({ erro: 'Número não encontrado' });
  const r = validarRecarga(req.body);
  if (r.erro) return res.status(400).json(r);
  const ins = inserirRecarga.run(req.params.id, r.data, r.valor, r.validade_dias, r.vencimento);
  res.status(201).json({ id: Number(ins.lastInsertRowid), vencimento: r.vencimento });
});

app.delete('/api/recargas/:id', (req, res) => {
  const r = db.prepare('DELETE FROM recargas WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Recarga não encontrada' });
  res.json({ ok: true });
});

app.post('/api/avisos/testar', async (req, res) => {
  try {
    await enviarEmail({
      assunto: '✅ Teste - Controle de Recargas',
      html: '<p>Se você recebeu este e-mail, os avisos de recarga estão funcionando.</p>',
      texto: 'Se você recebeu este e-mail, os avisos de recarga estão funcionando.',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: 'Falha ao enviar: ' + e.message });
  }
});

app.post('/api/avisos/verificar', async (req, res) => {
  try {
    res.json(await verificarEEnviar());
  } catch (e) {
    res.status(500).json({ erro: 'Falha ao enviar: ' + e.message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno' });
});

const PORTA = Number(process.env.PORT || 3000);
app.listen(PORTA, () => {
  console.log(`Controle de Recargas rodando em http://localhost:${PORTA}`);
  if (!SENHA) console.warn('ATENÇÃO: defina APP_SENHA no .env para conseguir entrar.');
  iniciarAgendamento();
});
