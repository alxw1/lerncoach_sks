-- SKS-Lerncoach: Datenbank-Einrichtung für Supabase.
-- Einmal komplett im Supabase-Dashboard unter „SQL Editor“ ausführen (mehrfaches Ausführen schadet nicht).

-- Admin = genau dieses Konto mit bestätigter E-Mail-Adresse.
-- Muss mit ADMIN_EMAIL in src/config.js und supabase/functions/grade/index.ts übereinstimmen.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = 'admin@weislogel.com'
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Einstellungen der KI-Bewertung (genau eine Zeile). Der OpenAI-Schlüssel ist nur für die
-- Server-Funktion lesbar; der Admin kann ihn setzen, aber nicht wieder auslesen.
create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  openai_api_key text,
  key_hint text generated always as (
    case when openai_api_key is null or openai_api_key = '' then null
         else left(openai_api_key, 3) || '…' || right(openai_api_key, 4) end
  ) stored,
  openai_model text not null default 'gpt-5-mini',
  daily_limit int not null default 100 check (daily_limit between 0 and 10000),
  updated_at timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;

alter table public.app_config enable row level security;
drop policy if exists "admin liest Einstellungen" on public.app_config;
create policy "admin liest Einstellungen" on public.app_config
  for select to authenticated using (public.is_admin());
drop policy if exists "admin ändert Einstellungen" on public.app_config;
create policy "admin ändert Einstellungen" on public.app_config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Spaltenrechte: Schlüssel nie an den Browser ausliefern.
revoke all on public.app_config from anon, authenticated;
grant select (id, key_hint, openai_model, daily_limit, updated_at) on public.app_config to authenticated;
grant update (openai_api_key, openai_model, daily_limit, updated_at) on public.app_config to authenticated;

-- Tageskontingent je Nutzer für KI-Bewertungen (schützt vor Kosten durch Missbrauch).
create table if not exists public.grade_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.grade_usage enable row level security;
drop policy if exists "eigene Nutzung lesen" on public.grade_usage;
create policy "eigene Nutzung lesen" on public.grade_usage
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.grade_usage from anon, authenticated;

-- Zählt eine Bewertung, wenn das Tageslimit noch nicht erreicht ist (nur für die Server-Funktion).
create or replace function public.consume_grade(p_user uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c int;
begin
  insert into public.grade_usage (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = public.grade_usage.count + 1
  returning count into c;
  if c > p_limit then
    update public.grade_usage set count = count - 1 where user_id = p_user and day = current_date;
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public.consume_grade(uuid, int) from public, anon, authenticated;
grant execute on function public.consume_grade(uuid, int) to service_role;
