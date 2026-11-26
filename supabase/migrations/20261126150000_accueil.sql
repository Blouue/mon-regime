-- Message d'accueil personnel : affiché 2 secondes à l'ouverture de l'appli.
-- Le texte est rempli à la main dans la base (jamais dans le code du site, qui est public).
-- Chacun ne lit que le sien et ne peut pas le modifier depuis l'appli.
create table if not exists public.accueil (
  user_id uuid primary key references auth.users(id) on delete cascade,
  texte   text not null check (char_length(texte) between 1 and 200)
);

alter table public.accueil enable row level security;
alter table public.accueil force row level security;

drop policy if exists accueil_lire on public.accueil;
create policy accueil_lire on public.accueil for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.accueil from anon, authenticated;
grant select on public.accueil to authenticated;
