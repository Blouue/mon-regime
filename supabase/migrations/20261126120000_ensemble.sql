-- « Ensemble » : se suivre entre amis, sans jamais exposer les données brutes.
-- Chacun publie volontairement un RÉSUMÉ (table partage). Un ami ne lit que ce résumé,
-- jamais les tables jours, repas, objectifs… qui restent protégées par leur RLS habituelle.

-- Résumé partagé : une ligne par utilisateur qui a activé le partage.
create table if not exists public.partage (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  pseudo     text not null check (char_length(pseudo) between 1 and 30),
  code       text not null unique check (code ~ '^[A-Z0-9]{8}$'),   -- code ami à donner
  stats      jsonb not null default '{}'::jsonb,                    -- résumé calculé par l'appli
  maj        timestamptz not null default now()
);

-- Liens d'amitié, toujours dans les deux sens (créés par la fonction ajouter_ami).
create table if not exists public.amis (
  user_id  uuid not null references auth.users(id) on delete cascade,
  ami_id   uuid not null references auth.users(id) on delete cascade,
  cree_le  timestamptz not null default now(),
  primary key (user_id, ami_id),
  check (user_id <> ami_id)
);

alter table public.partage enable row level security;
alter table public.partage force row level security;
alter table public.amis enable row level security;
alter table public.amis force row level security;

-- Mon résumé : je le lis, je le crée, je le modifie, je le supprime.
drop policy if exists partage_moi on public.partage;
create policy partage_moi on public.partage for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Le résumé de mes amis : lecture seule.
drop policy if exists partage_amis on public.partage;
create policy partage_amis on public.partage for select to authenticated
  using (exists (select 1 from public.amis a where a.user_id = (select auth.uid()) and a.ami_id = partage.user_id));

-- Mes liens : je les vois et je peux les supprimer (dans un sens comme dans l'autre).
-- Pas de création directe : uniquement par ajouter_ami(), qui exige le code de l'autre.
drop policy if exists amis_voir on public.amis;
create policy amis_voir on public.amis for select to authenticated
  using ((select auth.uid()) in (user_id, ami_id));
drop policy if exists amis_retirer on public.amis;
create policy amis_retirer on public.amis for delete to authenticated
  using ((select auth.uid()) in (user_id, ami_id));

-- Ajouter un ami avec son code. Connaître le code vaut accord de son propriétaire.
create or replace function public.ajouter_ami(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ami uuid; v_pseudo text; v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select user_id, pseudo into v_ami, v_pseudo from public.partage where code = v_code;
  if v_ami is null then raise exception 'Code inconnu : vérifie-le avec ton ami.'; end if;
  if v_ami = auth.uid() then raise exception 'C''est ton propre code !'; end if;
  if not exists (select 1 from public.partage where user_id = auth.uid()) then
    raise exception 'Active d''abord ton propre partage.';
  end if;
  insert into public.amis (user_id, ami_id) values (auth.uid(), v_ami) on conflict do nothing;
  insert into public.amis (user_id, ami_id) values (v_ami, auth.uid()) on conflict do nothing;
  return v_pseudo;
end $$;
revoke all on function public.ajouter_ami(text) from public, anon;
grant execute on function public.ajouter_ami(text) to authenticated;

revoke all on public.partage, public.amis from anon;
