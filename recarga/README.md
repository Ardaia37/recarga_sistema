# 📱 Controle de Recargas

Sistema web para cadastrar números de celular, registrar recargas e receber **avisos por e-mail** antes e depois do vencimento.

- Painel com status: 🔴 vencido · 🟡 vence em breve · 🟢 em dia · ⚪ sem recarga
- Histórico de recargas por número
- Um e-mail por dia, só quando há algo a avisar (3 dias antes, no dia e quando vence)
- Cada aviso é enviado uma vez só; ao registrar nova recarga, o prazo recomeça
- Login por senha, funciona no celular

**Tecnologias:** Node.js 22.5+, Express, SQLite (nativo do Node), Nodemailer, node-cron.

---

## 1. Rodar no seu computador

```bash
npm install
cp .env.example .env     # no Windows: copy .env.example .env
# edite o .env (senha do painel e dados do e-mail)
npm start
```

Abra http://localhost:3000

## 2. Configurar o e-mail (Gmail)

1. Ative a **verificação em duas etapas** na sua conta Google.
2. Acesse https://myaccount.google.com/apppasswords e crie uma **senha de app**.
3. No `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=seuemail@gmail.com
SMTP_PASS=a senha de app de 16 letras
```

4. No painel, clique em **Testar e-mail**.

Outros provedores (Outlook, Hostinger, Zoho) funcionam igual: troque host, porta e usuário.

## 3. Configurações do `.env`

| Variável | O que faz | Padrão |
|---|---|---|
| `APP_SENHA` | Senha para entrar no painel | obrigatório |
| `SESSION_SECRET` | Texto aleatório para proteger o login | obrigatório |
| `DIAS_AVISO` | Quantos dias antes avisar | `3` |
| `HORARIO_CRON` | Horário da verificação diária | `0 8 * * *` (08:00) |
| `EMAIL_DESTINO` | Para onde vão os avisos | o próprio `SMTP_USER` |
| `APP_URL` | Link do painel dentro do e-mail | vazio |
| `COOKIE_SEGURO` | `true` quando estiver em HTTPS | `false` |
| `PORT` | Porta do servidor | `3000` |

## 4. Hospedagem

O servidor precisa **ficar ligado o tempo todo** (é ele que dispara o e-mail diário) e precisa de **disco persistente** (o banco fica em `data/recargas.db`).

- **VPS** (Hostinger, Contabo, Oracle Cloud grátis, etc.) — melhor opção:
  ```bash
  npm install --omit=dev
  npm i -g pm2
  pm2 start npm --name recargas -- start
  pm2 save && pm2 startup
  ```
  Coloque um Nginx/Caddy na frente com HTTPS e use `COOKIE_SEGURO=true`.
- **Railway / Render / Fly.io**: funciona, mas use um plano que não "durma" e adicione um volume persistente apontando para `data/` (ou defina `DB_PATH`).

**Backup:** basta copiar o arquivo `data/recargas.db`.

## 5. Estrutura

```
src/
  server.js   rotas da API e login
  db.js       criação das tabelas (numeros, recargas, avisos)
  status.js   cálculo de situação de cada número
  avisos.js   verificação diária e montagem do e-mail
  mailer.js   envio via SMTP
  datas.js    funções de data no fuso de Cuiabá
public/
  index.html, style.css, app.js   página web
```

## API (resumo)

| Método | Rota | Uso |
|---|---|---|
| POST | `/api/login` | `{ senha }` |
| GET | `/api/numeros` | lista com status |
| POST | `/api/numeros` | `{ numero, operadora, apelido, recarga? }` |
| PUT/DELETE | `/api/numeros/:id` | editar / excluir |
| GET/POST | `/api/numeros/:id/recargas` | histórico / nova recarga `{ data, valor, validade_dias }` |
| DELETE | `/api/recargas/:id` | apagar recarga |
| POST | `/api/avisos/testar` | e-mail de teste |
| POST | `/api/avisos/verificar` | envia avisos pendentes agora |
