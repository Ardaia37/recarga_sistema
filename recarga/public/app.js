// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '-');

function fmtNumero(d) {
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
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
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

async function api(caminho, opcoes = {}) {
  const r = await fetch('/api' + caminho, {
    method: opcoes.method || 'GET',
    headers: opcoes.body ? { 'Content-Type': 'application/json' } : {},
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && caminho !== '/login') { mostrarLogin(); throw new Error('Sessão expirada'); }
  if (!r.ok) throw new Error(dados.erro || 'Erro inesperado');
  return dados;
}

// ---------- Estado ----------
let numeros = [];
let config = { dias_aviso: 3, hoje: new Date().toISOString().slice(0, 10) };

const ROTULO = { vencido: 'Vencido', vence_logo: 'Vence em breve', em_dia: 'Em dia', sem_recarga: 'Sem recarga' };

// ---------- Login ----------
function mostrarLogin() {
  $('#tela-app').hidden = true;
  $('#tela-login').hidden = false;
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#erro-login').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { senha: e.target.senha.value } });
    e.target.reset();
    iniciar();
  } catch (err) {
    $('#erro-login').textContent = err.message;
  }
});

$('#btn-sair').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  mostrarLogin();
});

// ---------- Painel ----------
async function iniciar() {
  try {
    config = await api('/config');
  } catch { return; }
  $('#tela-login').hidden = true;
  $('#tela-app').hidden = false;
  await carregar();
}

async function carregar() {
  numeros = await api('/numeros');
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
    try { await api(`/numeros/${n.id}`, { method: 'DELETE' }); toast('Número excluído'); carregar(); }
    catch (err) { toast(err.message); }
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
  formNumero.data.value = config.hoje;
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
  const corpo = { numero: f.numero.value, operadora: f.operadora.value, apelido: f.apelido.value };
  if (!f.id.value && f.com_recarga.checked) {
    corpo.recarga = { data: f.data.value, valor: f.valor.value, validade_dias: f.validade_dias.value };
  }
  const btn = e.submitter; btn.disabled = true;
  try {
    if (f.id.value) await api(`/numeros/${f.id.value}`, { method: 'PUT', body: corpo });
    else await api('/numeros', { method: 'POST', body: corpo });
    dlgNumero.close();
    toast('Salvo!');
    carregar();
  } catch (err) {
    f.querySelector('.erro').textContent = err.message;
  } finally { btn.disabled = false; }
});

// ---------- Modal: recarga ----------
const dlgRecarga = $('#dlg-recarga');
const formRecarga = $('#form-recarga');

function abrirRecarga(n) {
  formRecarga.reset();
  formRecarga.querySelector('.erro').textContent = '';
  formRecarga.numero_id.value = n.id;
  formRecarga.data.value = config.hoje;
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
    const r = await api(`/numeros/${f.numero_id.value}/recargas`, {
      method: 'POST',
      body: { data: f.data.value, valor: f.valor.value, validade_dias: f.validade_dias.value },
    });
    dlgRecarga.close();
    toast(`Recarga registrada. Vence em ${dataBR(r.vencimento)}`);
    carregar();
  } catch (err) {
    f.querySelector('.erro').textContent = err.message;
  } finally { btn.disabled = false; }
});

// ---------- Modal: histórico ----------
const dlgHist = $('#dlg-historico');
let histAtual = null;

async function abrirHistorico(n) {
  histAtual = n;
  $('#historico-alvo').textContent = `${n.apelido ? n.apelido + ' · ' : ''}${fmtNumero(n.numero)} · ${n.operadora}`;
  $('#historico-lista').innerHTML = 'Carregando...';
  dlgHist.showModal();
  const recs = await api(`/numeros/${n.id}/recargas`);
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
  try {
    await api(`/recargas/${b.dataset.apagar}`, { method: 'DELETE' });
    await carregar();
    abrirHistorico(numeros.find((x) => x.id === histAtual.id));
  } catch (err) { toast(err.message); }
});
$('#fechar-historico').addEventListener('click', () => dlgHist.close());

// ---------- Avisos ----------
$('#btn-testar').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try { await api('/avisos/testar', { method: 'POST' }); toast(`E-mail de teste enviado para ${config.email_destino}`); }
  catch (err) { toast(err.message); }
  finally { e.target.disabled = false; }
});

$('#btn-verificar').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/avisos/verificar', { method: 'POST' });
    toast(r.enviados ? `Aviso enviado com ${r.enviados} número(s)` : 'Nenhum aviso pendente agora');
  } catch (err) { toast(err.message); }
  finally { e.target.disabled = false; }
});

iniciar();
