// Edge Function: envia os avisos de recarga por e-mail (Gmail/SMTP)
// Modos:
//   cron      -> chamado pelo agendamento diário (header x-cron-secret), avisa todos os usuários
//   verificar -> chamado pelo painel (usuário logado), avisa só esse usuário
//   testar    -> chamado pelo painel, envia um e-mail de teste
import postgres from "npm:postgres@3.4.5";
import nodemailer from "npm:nodemailer@6.9.16";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function transporter() {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!user || !pass) {
    throw new Error("SMTP não configurado: cadastre SMTP_USER e SMTP_PASS nos secrets das Edge Functions");
  }
  return nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com",
    port: 465, // a porta 587 é bloqueada nas Edge Functions
    secure: true,
    auth: { user, pass },
  });
}

async function enviar(para: string, assunto: string, html: string, texto: string) {
  const de = `Controle de Recargas <${Deno.env.get("SMTP_USER")}>`;
  await transporter().sendMail({ from: de, to: para, subject: assunto, html, text: texto });
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function fmtNumero(d: string) {
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
const dataBR = (d: string) => d.split("-").reverse().join("/");

type Item = {
  user_id: string; email: string; numero: string; operadora: string; apelido: string | null;
  recarga_id: number; vencimento: string; dias_restantes: number; tipo: "antes" | "hoje" | "vencido";
};

async function pendentes(userId: string | null): Promise<Item[]> {
  return await sql<Item[]>`
    select s.user_id, u.email, s.numero, s.operadora, s.apelido, s.recarga_id,
           to_char(s.vencimento, 'YYYY-MM-DD') as vencimento, s.dias_restantes,
           case when s.dias_restantes < 0 then 'vencido'
                when s.dias_restantes = 0 then 'hoje'
                else 'antes' end as tipo
    from public.numeros_status s
    join auth.users u on u.id = s.user_id
    where s.recarga_id is not null
      and s.dias_restantes <= 3
      and (${userId}::uuid is null or s.user_id = ${userId}::uuid)
      and not exists (
        select 1 from public.avisos a
        where a.recarga_id = s.recarga_id
          and a.tipo = case when s.dias_restantes < 0 then 'vencido'
                            when s.dias_restantes = 0 then 'hoje'
                            else 'antes' end
      )
    order by s.dias_restantes`;
}

function montarEmail(itens: Item[]) {
  const rotulo = { vencido: "VENCIDO", hoje: "VENCE HOJE", antes: "Vence em breve" };
  const cor = { vencido: "#c0392b", hoje: "#d35400", antes: "#b7950b" };
  const desc = (i: Item) =>
    i.dias_restantes < 0 ? `venceu há ${-i.dias_restantes} dia(s)`
      : i.dias_restantes === 0 ? "vence hoje" : `faltam ${i.dias_restantes} dia(s)`;
  const td = "padding:8px;border-bottom:1px solid #eee";

  const linhas = itens.map((i) => `
    <tr>
      <td style="${td}"><strong>${esc(i.apelido || "-")}</strong><br>${fmtNumero(i.numero)}</td>
      <td style="${td}">${esc(i.operadora)}</td>
      <td style="${td}">${dataBR(i.vencimento)}</td>
      <td style="${td};color:${cor[i.tipo]};font-weight:bold">${rotulo[i.tipo]}<br><span style="font-weight:normal">${desc(i)}</span></td>
    </tr>`).join("");

  const appUrl = Deno.env.get("APP_URL");
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
    <h2 style="margin-bottom:4px">📱 Aviso de recargas</h2>
    <p style="color:#555;margin-top:0">${itens.length} número(s) precisam de atenção.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="background:#f4f4f4;text-align:left">
        <th style="padding:8px">Número</th><th style="padding:8px">Operadora</th>
        <th style="padding:8px">Vencimento</th><th style="padding:8px">Situação</th>
      </tr>${linhas}
    </table>
    ${appUrl ? `<p><a href="${esc(appUrl)}">Abrir o painel</a></p>` : ""}
  </div>`;

  const texto = itens.map((i) =>
    `${rotulo[i.tipo]} - ${i.apelido ?? ""} ${fmtNumero(i.numero)} (${i.operadora}) - vencimento ${dataBR(i.vencimento)} - ${desc(i)}`
  ).join("\n");

  const urgente = itens.some((i) => i.tipo !== "antes");
  const assunto = urgente
    ? `⚠️ Recarga vencendo/vencida: ${itens.length} número(s)`
    : `📱 Recarga vence em breve: ${itens.length} número(s)`;
  return { assunto, html, texto };
}

async function processar(userId: string | null) {
  const itens = await pendentes(userId);
  const porEmail = new Map<string, Item[]>();
  for (const i of itens) porEmail.set(i.email, [...(porEmail.get(i.email) ?? []), i]);

  let enviados = 0;
  const erros: string[] = [];
  for (const [email, lista] of porEmail) {
    try {
      const m = montarEmail(lista);
      await enviar(email, m.assunto, m.html, m.texto);
      for (const i of lista) {
        await sql`insert into public.avisos (recarga_id, tipo) values (${i.recarga_id}, ${i.tipo})
                  on conflict (recarga_id, tipo) do nothing`;
      }
      enviados += lista.length;
    } catch (e) {
      erros.push(`${email}: ${(e as Error).message}`);
    }
  }
  return { enviados, erros };
}

async function usuarioDoToken(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data, error } = await sb.auth.getUser(token);
  return error ? null : data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);

  try {
    const corpo = await req.json().catch(() => ({}));
    const modo = corpo.modo ?? "verificar";

    if (modo === "cron") {
      const recebido = req.headers.get("x-cron-secret") ?? "";
      const [s] = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'cron_avisos_secret'`;
      if (!s || !recebido || recebido !== s.decrypted_secret) return json({ erro: "Não autorizado" }, 401);
      const r = await processar(null);
      console.log("[cron]", JSON.stringify(r));
      return json(r);
    }

    const user = await usuarioDoToken(req);
    if (!user) return json({ erro: "Faça login novamente" }, 401);

    if (modo === "testar") {
      await enviar(
        user.email!,
        "✅ Teste - Controle de Recargas",
        "<p>Se você recebeu este e-mail, os avisos de recarga estão funcionando.</p>",
        "Se você recebeu este e-mail, os avisos de recarga estão funcionando.",
      );
      return json({ ok: true, email: user.email });
    }

    if (modo === "verificar") {
      const r = await processar(user.id);
      if (r.erros.length) return json({ erro: r.erros.join("; ") }, 500);
      return json(r);
    }

    return json({ erro: "Modo inválido" }, 400);
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});
