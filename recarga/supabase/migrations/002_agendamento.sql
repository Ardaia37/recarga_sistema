-- Agendamento diário: 12:00 UTC = 08:00 em Cuiabá
create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_avisos_secret', 'Autoriza o agendamento a chamar enviar-avisos');

select cron.schedule('enviar-avisos-recarga', '0 12 * * *', $$
  select net.http_post(
    url     := 'https://flgncteevugmuaxsptif.supabase.co/functions/v1/enviar-avisos',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_avisos_secret')),
    body    := '{"modo":"cron"}'::jsonb,
    timeout_milliseconds := 30000);
$$);
