# 📱 Controle de Recargas (Supabase + Vercel)

Cadastre números de celular, registre recargas e receba **avisos por e-mail** antes e depois do vencimento.

- Painel com status: 🔴 vencido · 🟡 vence em breve · 🟢 em dia · ⚪ sem recarga
- Histórico de recargas por número
- Um e-mail por dia às 08h (Cuiabá), só quando há algo a avisar: 3 dias antes, no dia e quando vence
- Login com e-mail e senha (Supabase Auth); cada conta só vê os próprios números

## Como funciona

| Parte | Onde roda |
|---|---|
| Página web (`public/`) | Vercel (site estático, sem build) |
| Banco de dados | Supabase – projeto `controle-recargas` |
| Envio de e-mail | Supabase Edge Function `enviar-avisos` (Gmail, porta 465) |
| Agendamento diário | Supabase `pg_cron`, 12:00 UTC = 08:00 Cuiabá |

O banco, a função e o agendamento **já estão criados** no Supabase (organização "Ardaia37's Org", projeto `flgncteevugmuaxsptif`). Os arquivos em `supabase/` ficam aqui só como referência.

## 1. Cadastrar a senha do Gmail no Supabase (obrigatório)

Painel do Supabase → projeto **controle-recargas** → **Edge Functions → Secrets** → adicione:

| Nome | Valor |
|---|---|
| `SMTP_USER` | seu Gmail (quem envia os avisos) |
| `SMTP_PASS` | a senha de app de 16 letras do Google |
| `APP_URL` | (opcional) endereço do site no Vercel, aparece como link no e-mail |

Os avisos chegam no **e-mail da conta** que você criar no painel.

## 2. Testar no computador

Abra `public/index.html` no navegador (dois cliques). Crie a conta, confirme pelo e-mail e entre.

## 3. Publicar no Vercel

1. Suba esta pasta para o GitHub.
2. No Vercel: **Add New → Project** → escolha o repositório.
3. Em **Root Directory**, aponte para a pasta deste projeto (onde está o `vercel.json`).
4. Framework: **Other**. Não precisa de build nem de variáveis de ambiente.
5. **Deploy**.

Depois, no Supabase → **Authentication → URL Configuration**, coloque o endereço do Vercel em **Site URL**.

## 4. Segurança

- A chave em `public/config.js` é a chave **pública** (publishable). Pode ficar no GitHub: quem protege os dados são as regras RLS do banco.
- Depois de criar sua conta, desative novos cadastros em **Authentication → Sign In / Providers → Allow new users to sign up**.
- A senha do Gmail fica só nos Secrets do Supabase, nunca no código.

## Estrutura

```
public/
  index.html, style.css, app.js   página web
  config.js                       URL e chave pública do Supabase
  vendor/supabase.js              biblioteca do Supabase (sem depender de CDN)
supabase/
  functions/enviar-avisos/index.ts   envio dos e-mails
  migrations/*.sql                   tabelas, segurança e agendamento
vercel.json
```
