// Monta a situação atual de cada número a partir da última recarga
const db = require('./db');
const { hoje, diasEntre } = require('./datas');

const DIAS_AVISO = () => Number(process.env.DIAS_AVISO || 3);

function situacao(diasRestantes) {
  if (diasRestantes === null) return 'sem_recarga';
  if (diasRestantes < 0) return 'vencido';
  if (diasRestantes <= DIAS_AVISO()) return 'vence_logo';
  return 'em_dia';
}

function listarNumerosComStatus() {
  const linhas = db.prepare(`
    SELECT n.*, r.id AS recarga_id, r.data, r.valor, r.validade_dias, r.vencimento
    FROM numeros n
    LEFT JOIN recargas r ON r.id = (
      SELECT id FROM recargas WHERE numero_id = n.id ORDER BY data DESC, id DESC LIMIT 1
    )
    ORDER BY n.apelido COLLATE NOCASE, n.numero
  `).all();

  const h = hoje();
  return linhas.map((l) => {
    const dias = l.vencimento ? diasEntre(h, l.vencimento) : null;
    return {
      id: l.id,
      numero: l.numero,
      ddd: l.ddd,
      operadora: l.operadora,
      apelido: l.apelido,
      ultima_recarga: l.recarga_id
        ? { id: l.recarga_id, data: l.data, valor: l.valor, validade_dias: l.validade_dias, vencimento: l.vencimento }
        : null,
      dias_restantes: dias,
      situacao: situacao(dias),
    };
  });
}

module.exports = { listarNumerosComStatus, situacao, DIAS_AVISO };
