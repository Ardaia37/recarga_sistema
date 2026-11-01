-- Já aplicado no projeto Supabase "controle-recargas". Guardado aqui como referência.
create table public.numeros (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero      text not null check (numero ~ '^[0-9]{10,11}$'),
  ddd         text generated always as (left(numero, 2)) stored,
  operadora   text not null check (length(trim(operadora)) > 0),
  apelido     text,
  criado_em   timestamptz not null default now(),
  unique (user_id, numero)
);

create table public.recargas (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero_id      bigint not null references public.numeros(id) on delete cascade,
  data           date not null default ((now() at time zone 'America/Cuiaba')::date),
  valor          numeric(10,2) not null check (valor > 0),
  validade_dias  integer not null check (validade_dias between 1 and 365),
  vencimento     date generated always as (data + validade_dias) stored,
  criado_em      timestamptz not null default now()
);
create index recargas_numero_idx on public.recargas (numero_id, data desc, id desc);
create index recargas_user_idx on public.recargas (user_id);
create index numeros_user_idx on public.numeros (user_id);

create table public.avisos (
  id          bigint generated always as identity primary key,
  recarga_id  bigint not null references public.recargas(id) on delete cascade,
  tipo        text not null check (tipo in ('antes', 'hoje', 'vencido')),
  enviado_em  timestamptz not null default now(),
  unique (recarga_id, tipo)
);

alter table public.numeros  enable row level security;
alter table public.recargas enable row level security;
alter table public.avisos   enable row level security;

create policy "dono vê seus números"      on public.numeros for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria seus números"    on public.numeros for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono edita seus números"   on public.numeros for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga seus números"   on public.numeros for delete to authenticated using ((select auth.uid()) = user_id);
create policy "dono vê suas recargas"     on public.recargas for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria suas recargas"   on public.recargas for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.numeros n where n.id = numero_id and n.user_id = (select auth.uid()))
);
create policy "dono apaga suas recargas"  on public.recargas for delete to authenticated using ((select auth.uid()) = user_id);

create view public.numeros_status with (security_invoker = true) as
select
  n.id, n.user_id, n.numero, n.ddd, n.operadora, n.apelido,
  r.id as recarga_id, r.data, r.valor, r.validade_dias, r.vencimento,
  (r.vencimento - (now() at time zone 'America/Cuiaba')::date) as dias_restantes,
  case
    when r.id is null then 'sem_recarga'
    when r.vencimento < (now() at time zone 'America/Cuiaba')::date then 'vencido'
    when r.vencimento - (now() at time zone 'America/Cuiaba')::date <= 3 then 'vence_logo'
    else 'em_dia'
  end as situacao
from public.numeros n
left join lateral (
  select * from public.recargas x where x.numero_id = n.id order by x.data desc, x.id desc limit 1
) r on true;

grant select on public.numeros_status to authenticated;
revoke all on public.numeros_status from anon;
revoke all on public.numeros, public.recargas from anon;
revoke all on public.avisos from anon, authenticated;
