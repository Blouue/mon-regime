-- Mon régime : schéma et sécurité (RLS)
-- À exécuter une fois dans Supabase → SQL Editor (ou `supabase db push`).
-- Chaque table personnelle porte user_id et n'est lisible / modifiable que par son propriétaire.

-- ---------- Objectifs ----------
create table if not exists public.objectifs (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  kcal        integer check (kcal between 500 and 6000),
  prot        integer check (prot between 0 and 500),
  gluc        integer check (gluc between 0 and 1000),
  lip         integer check (lip between 0 and 500),
  pas         integer check (pas between 0 and 100000),
  poids_cible numeric(5,1) check (poids_cible between 20 and 400),
  updated_at  timestamptz not null default now()
);

-- ---------- Jours (données Apple Santé ou saisie manuelle) ----------
create table if not exists public.jours (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  poids      numeric(5,1) check (poids between 20 and 400),
  pas        integer check (pas between 0 and 200000),
  kcal       integer check (kcal between 0 and 20000),
  prot       integer check (prot between 0 and 2000),
  gluc       integer check (gluc between 0 and 3000),
  lip        integer check (lip between 0 and 2000),
  source     text check (source in ('raccourci','collage','manuel')),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- ---------- Journal des repas ----------
create table if not exists public.repas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  moment     text not null check (moment in ('Matin','Midi','Goûter','Soir')),
  nom        text not null check (char_length(nom) <= 300),
  kcal       integer check (kcal between 0 and 10000),
  created_at timestamptz not null default now()
);
create index if not exists repas_user_date on public.repas (user_id, date);

-- ---------- Menu de la semaine (Jow ou recette générée) ----------
create table if not exists public.menus (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  semaine    date not null,              -- lundi de la semaine
  jour       smallint not null check (jour between 0 and 6),  -- 0 = lundi
  nom        text not null default '' check (char_length(nom) <= 300),
  lien       text not null default '' check (lien = '' or lien ~* '^https://'),
  recette    jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, semaine, jour)
);

-- ---------- Textes libres : notes, garde-manger, ingrédients courants ----------
create table if not exists public.notes (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  texte      text not null default '' check (char_length(texte) <= 20000),
  updated_at timestamptz not null default now()
);
create table if not exists public.placard (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  texte      text not null default '' check (char_length(texte) <= 5000),
  updated_at timestamptz not null default now()
);
create table if not exists public.ingredients (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  liste      text[] not null default '{}' check (cardinality(liste) <= 80),
  updated_at timestamptz not null default now()
);

-- ---------- Jeton du raccourci iPhone (on ne garde que son empreinte SHA-256) ----------
create table if not exists public.jetons_import (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  jeton_hash text not null unique check (jeton_hash ~ '^[0-9a-f]{64}$'),
  cree_le    timestamptz not null default now(),
  dernier_usage timestamptz
);

-- ---------- Relevés Leclerc Drive (écrits par le script, avec la clé service_role) ----------
create table if not exists public.dispo_leclerc (
  id        bigint generated always as identity primary key,
  releve_le timestamptz not null default now(),
  magasin   text not null default 'Saint-Berthevin',
  statut    text not null check (statut in ('ok','partiel','erreur')),
  message   text,
  produits  jsonb not null default '[]'  -- [{ing, n, ok, top:[{nom, prix, kg, promo}]}]
);
create index if not exists dispo_leclerc_date on public.dispo_leclerc (releve_le desc);

-- ---------- Mise à jour automatique de updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['objectifs','jours','menus','notes','placard','ingredients'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['objectifs','jours','repas','menus','notes','placard','ingredients','jetons_import'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists proprietaire on public.%I', t);
    execute format($p$create policy proprietaire on public.%I for all to authenticated
                     using ((select auth.uid()) = user_id)
                     with check ((select auth.uid()) = user_id)$p$, t);
  end loop;
end $$;

-- Le jeton ne se relit pas : le navigateur peut seulement en créer un nouveau ou le supprimer.
revoke select on public.jetons_import from authenticated;
grant select (user_id, cree_le, dernier_usage) on public.jetons_import to authenticated;

-- Relevé Leclerc : lecture pour les comptes connectés, aucune écriture côté navigateur.
alter table public.dispo_leclerc enable row level security;
drop policy if exists lecture on public.dispo_leclerc;
create policy lecture on public.dispo_leclerc for select to authenticated using (true);

-- Rien pour les visiteurs non connectés.
revoke all on all tables in schema public from anon;
