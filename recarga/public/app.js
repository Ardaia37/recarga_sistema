// ---------- Supabase ----------
const sb = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_KEY);
const FUNCAO_AVISOS = window.APP_CONFIG.SUPABASE_URL + '/functions/v1/enviar-avisos';

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '-');
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(new Date());

function fmtNumero(d) {
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
function limparNumero(s) {
  return String(s || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
}
function somarDias(iso, dias) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(dias));
  return d.toISOString().slice(0, 10);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

// Traduz erros do Supabase para mensagens simples
function mensagemErro(e) {
  const msg = e?.message || String(e);
  if (e?.code === '23505') return 'Esse número já está cadastrado';
  if (e?.code === '23514') return 'Algum campo está com valor inválido';
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos';
  if (/Email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada)';
  if (/already registered/i.test(msg)) return 'Esse e-mail já tem conta. Use "Entrar".';
  if (/Password should be/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres';
  if (/Signups not allowed/i.test(msg)) return 'Cadastro de novas contas está desativado';
  if (/Failed to fetch/i.test(msg)) return 'Sem conexão com o servidor';
  return msg;
}

function validarRecarga({ data, valor, validade_dias }) {
  const s = String(valor ?? '').trim();
  const v = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  const val = parseInt(validade_dias, 10);
  if (!data) throw new Error('Informe a data da recarga');
  if (!(v > 0)) throw new Error('Valor da recarga inválido');
  if (!(val >= 1 && val <= 365)) throw new Error('Validade deve ser entre 1 e 365 dias');
  return { data, valor: v, validade_dias: val };
}

async function chamarAvisos(modo) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { mostrarLogin(); throw new Error('Faça login novamente'); }
  const r = await fetch(FUNCAO_AVISOS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + session.access_token,
      apikey: window.APP_CONFIG.SUPABASE_KEY,
    },
    body: JSON.stringify({ modo }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Erro ao enviar e-mail');
  return dados;
}

// ---------- Estado ----------
let numeros = [];
const ROTULO = { vencido: 'Vencido', vence_logo: 'Vence em breve', em_dia: 'Em dia', sem_recarga: 'Sem recarga' };

// ---------- Login / cadastro ----------
let modoCadastro = false;

function mostrarLogin() {
  $('#tela-app').hidden = true;
  $('#tela-login').hidden = false;
}

$('#btn-alternar').addEventListener('click', () => {
  modoCadastro = !modoCadastro;
  $('#btn-login').textContent = modoCadastro ? 'Criar conta' : 'Entrar';
  $('#btn-alternar').textContent = modoCadastro ? 'Já tenho conta' : 'Criar conta';
  $('#login-sub').textContent = modoCadastro ? 'Os avisos vão para este e-mail' : 'Entre com seu e-mail e senha';
  $('#form-login').senha.autocomplete = modoCadastro ? 'new-password' : 'current-password';
  $('#erro-login').textContent = '';
  $('#ok-login').textContent = '';
});

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#erro-login').textContent = '';
  $('#ok-login').textContent = '';
  const btn = $('#btn-login'); btn.disabled = true;
  try {
    const cred = { email: f.email.value.trim(), password: f.senha.value };
    if (modoCadastro) {
      const { data, error } = await sb.auth.signUp({ ...cred, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) {
        $('#ok-login').textContent = 'Conta criada! Abra o e-mail de confirmação que enviamos e depois entre aqui.';
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword(cred);
      if (error) throw error;
    }
    f.senha.value = '';
    iniciar();
  } catch (err) {
    $('#erro-login').textContent = mensagemErro(err);
  } finally { btn.disabled = false; }
});

$('#btn-sair').addEventListener('click', async () => {
  await sb.auth.signOut();
  mostrarLogin();
});

// ---------- Painel ----------
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return mostrarLogin();
  $('#usuario-email').textContent = session.user.email;
  $('#tela-login').hidden = true;
  $('#tela-app').hidden = false;
  await carregar();
}

async function carregar() {
  const { data, error } = await sb.from('numeros_status').select('*');
  if (error) { toast(mensagemErro(error)); return; }
  numeros = data.map((n) => ({
    ...n,
    ultima_recarga: n.recarga_id
      ? { id: n.recarga_id, data: n.data, valor: n.valor, validade_dias: n.validade_dias, vencimento: n.vencimento }
      : null,
  }));
  render();
}

function render() {
  const cont = { vencido: 0, vence_logo: 0, em_dia: 0, sem_recarga: 0 };
  numeros.forEach((n) => cont[n.situacao]++);
  const filtro = $('#filtro').value;

  $('#resumo').innerHTML = ['vencido', 'vence_logo', 'em_dia', 'sem_recarga'].map((k) => `
    <button data-filtro="${k}" class="${filtro === k ? 'ativo' : ''}">
      <strong>${cont[k]}</strong><span>${ROTULO[k]}</span>
    </button>`).join('');

  const busca = $('#busca').value.trim().toLowerCase();
  const buscaDigitos = busca.replace(/\D/g, '');
  const ordem = { vencido: 0, vence_logo: 1, em_dia: 2, sem_recarga: 3 };

  const lista = numeros
    .filter((n) => !filtro || n.situacao === filtro)
    .filter((n) => !busca ||
      (n.apelido || '').toLowerCase().includes(busca) ||
      n.operadora.toLowerCase().includes(busca) ||
      (buscaDigitos && n.numero.includes(buscaDigitos)))
    .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || (a.dias_restantes ?? 9999) - (b.dias_restantes ?? 9999));

  if (!lista.length) {
    $('#lista').innerHTML = `<div class="vazio cartao">${numeros.length ? 'Nenhum número encontrado.' : 'Nenhum número cadastrado ainda. Clique em <strong>+ Novo número</strong>.'}</div>`;
    return;
  }

  $('#lista').innerHTML = lista.map((n) => {
    const r = n.ultima_recarga;
    let prazo = 'Nenhuma recarga registrada';
    if (r) {
      const d = n.dias_restantes;
      const quando = d < 0 ? `venceu há ${-d} dia(s)` : d === 0 ? 'vence hoje' : `faltam ${d} dia(s)`;
      prazo = `Vence em ${dataBR(r.vencimento)} · ${quando} · última: ${brl(r.valor)} em ${dataBR(r.data)}`;
    }
    return `
      <article class="item cartao ${n.situacao}">
        <div>
          <div class="titulo">${esc(n.apelido || fmtNumero(n.numero))}<span class="selo ${n.situacao}">${ROTULO[n.situacao]}</span></div>
          <div class="meta">${n.apelido ? fmtNumero(n.numero) + ' · ' : ''}${esc(n.operadora)} · DDD ${n.ddd}</div>
          <div class="meta">${prazo}</div>
        </div>
        <div class="acoes">
          <button class="btn primario pequeno" data-acao="recarga" data-id="${n.id}">+ Recarga</button>
          <button class="btn pequeno" data-acao="historico" data-id="${n.id}">Histórico</button>
          <button class="btn pequeno" data-acao="editar" data-id="${n.id}">Editar</button>
          <button class="btn pequeno perigo" data-acao="excluir" data-id="${n.id}">Excluir</button>
        </div>
      </article>`;
  }).join('');
}

$('#resumo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filtro]');
  if (!b) return;
  $('#filtro').value = $('#filtro').value === b.dataset.filtro ? '' : b.dataset.filtro;
  render();
});
$('#filtro').addEventListener('change', render);
$('#busca').addEventListener('input', render);

$('#lista').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acao]');
  if (!b) return;
  const n = numeros.find((x) => x.id === Number(b.dataset.id));
  if (b.dataset.acao === 'recarga') abrirRecarga(n);
  if (b.dataset.acao === 'editar') abrirNumero(n);
  if (b.dataset.acao === 'historico') abrirHistorico(n);
  if (b.dataset.acao === 'excluir') {
    if (!confirm(`Excluir ${n.apelido || fmtNumero(n.numero)} e todo o histórico de recargas?`)) return;
    const { error } = await sb.from('numeros').delete().eq('id', n.id);
    if (error) return toast(mensagemErro(error));
    toast('Número excluído');
    carregar();
  }
});

// ---------- Modal: número ----------
const dlgNumero = $('#dlg-numero');
const formNumero = $('#form-numero');

$('#btn-novo').addEventListener('click', () => abrirNumero(null));

function abrirNumero(n) {
  formNumero.reset();
  formNumero.querySelector('.erro').textContent = '';
  $('#titulo-numero').textContent = n ? 'Editar número' : 'Novo número';
  $('#grupo-primeira-recarga').hidden = !!n;
  formNumero.id.value = n ? n.id : '';
  formNumero.numero.value = n ? fmtNumero(n.numero) : '';
  formNumero.operadora.value = n ? n.operadora : 'Claro';
  formNumero.apelido.value = n ? n.apelido || '' : '';
  formNumero.data.value = hoje();
  formNumero.validade_dias.value = 30;
  formNumero.querySelectorAll('.grade-3 input').forEach((i) => (i.disabled = false));
  dlgNumero.showModal();
}

formNumero.com_recarga.addEventListener('change', (e) => {
  formNumero.querySelectorAll('.grade-3 input').forEach((i) => (i.disabled = !e.target.checked));
});

formNumero.addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancelar') return;
  e.preventDefault();
  const f = formNumero;
  const btn = e.submitter; btn.disabled = true;
  try {
    const numero = limparNumero(f.numero.value);
    if (numero.length < 10 || numero.length > 11) throw new Error('Informe o número com DDD (10 ou 11 dígitos)');
    const dados = { numero, operadora: f.operadora.value, apelido: f.apelido.value.trim() || null };

    if (f.id.value) {
      const { error } = await sb.from('numeros').update(dados).eq('id', f.id.value);
      if (error) throw error;
    } else {
      const recarga = f.com_recarga.checked
        ? validarRecarga({ data: f.data.value, valor: f.valor.value, validade_dias: f.validade_dias.value })
        : null;
      const { data: novo, error } = await sb.from('numeros').insert(dados).select('id').single();
      if (error) throw error;
      if (recarga) {
        const { error: e2 } = await sb.from('recargas').insert({ ...recarga, numero_id: novo.id });
        if (e2) throw e2;
      }
    }
    dlgNumero.close();
    toast('Salvo!');
    carregar();
  } catch (err) {
    f.querySelector('.erro').textContent = mensagemErro(err);
  } finally { btn.disabled = false; }
});

// ---------- Modal: recarga ----------
const dlgRecarga = $('#dlg-recarga');
const formRecarga = $('#form-recarga');

function abrirRecarga(n) {
  formRecarga.reset();
  formRecarga.querySelector('.erro').textContent = '';
  formRecarga.numero_id.value = n.id;
  formRecarga.data.value = hoje();
  formRecarga.validade_dias.value = n.ultima_recarga?.validade_dias || 30;
  if (n.ultima_recarga) formRecarga.valor.value = String(n.ultima_recarga.valor).replace('.', ',');
  $('#recarga-alvo').textContent = `${n.apelido ? n.apelido + ' · ' : ''}${fmtNumero(n.numero)} · ${n.operadora}`;
  atualizarPrevia();
  dlgRecarga.showModal();
}

function atualizarPrevia() {
  const d = formRecarga.data.value, v = parseInt(formRecarga.validade_dias.value, 10);
  $('#previa-venc').textContent = d && v > 0 ? `Novo vencimento: ${dataBR(somarDias(d, v))}` : '';
}
formRecarga.data.addEventListener('input', atualizarPrevia);
formRecarga.validade_dias.addEventListener('input', atualizarPrevia);

formRecarga.addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancelar') return;
  e.preventDefault();
  const f = formRecarga;
  const btn = e.submitter; btn.disabled = true;
  try {
    const recarga = validarRecarga({ data: f.data.value, valor: f.valor.value, validade_dias: f.validade_dias.value });
    const { data: nova, error } = await sb.from('recargas')
      .insert({ ...recarga, numero_id: Number(f.numero_id.value) })
      .select('vencimento').single();
    if (error) throw error;
    dlgRecarga.close();
    toast(`Recarga registrada. Vence em ${dataBR(nova.vencimento)}`);
    carregar();
  } catch (err) {
    f.querySelector('.erro').textContent = mensagemErro(err);
  } finally { btn.disabled = false; }
});

// ---------- Modal: histórico ----------
const dlgHist = $('#dlg-historico');
let histAtual = null;

async function abrirHistorico(n) {
  histAtual = n;
  $('#historico-alvo').textContent = `${n.apelido ? n.apelido + ' · ' : ''}${fmtNumero(n.numero)} · ${n.operadora}`;
  $('#historico-lista').innerHTML = 'Carregando...';
  if (!dlgHist.open) dlgHist.showModal();
  const { data: recs, error } = await sb.from('recargas').select('*').eq('numero_id', n.id)
    .order('data', { ascending: false }).order('id', { ascending: false });
  if (error) { $('#historico-lista').textContent = mensagemErro(error); return; }
  $('#historico-lista').innerHTML = recs.length ? `
    <table class="hist">
      <tr><th>Data</th><th>Valor</th><th>Validade</th><th>Vencimento</th><th></th></tr>
      ${recs.map((r) => `
        <tr>
          <td>${dataBR(r.data)}</td><td>${brl(r.valor)}</td><td>${r.validade_dias} dias</td><td>${dataBR(r.vencimento)}</td>
          <td><button class="btn pequeno perigo" data-apagar="${r.id}" title="Apagar recarga">✕</button></td>
        </tr>`).join('')}
    </table>` : '<p class="sub">Nenhuma recarga registrada.</p>';
}

$('#historico-lista').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-apagar]');
  if (!b || !confirm('Apagar esta recarga?')) return;
  const { error } = await sb.from('recargas').delete().eq('id', b.dataset.apagar);
  if (error) return toast(mensagemErro(error));
  await carregar();
  abrirHistorico(numeros.find((x) => x.id === histAtual.id));
});
$('#fechar-historico').addEventListener('click', () => dlgHist.close());

// ---------- Avisos ----------
$('#btn-testar').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try { const r = await chamarAvisos('testar'); toast(`E-mail de teste enviado para ${r.email}`); }
  catch (err) { toast(err.message); }
  finally { e.target.disabled = false; }
});

$('#btn-verificar').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await chamarAvisos('verificar');
    toast(r.enviados ? `Aviso enviado com ${r.enviados} número(s)` : 'Nenhum aviso pendente agora');
  } catch (err) { toast(err.message); }
  finally { e.target.disabled = false; }
});

// Sessão: volta para o login se expirar; entra direto após confirmar e-mail
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT') mostrarLogin();
});

iniciar();
