-- Profil pour le calcul automatique des objectifs (formule de Mifflin-St Jeor).
-- Ajout de colonnes uniquement : aucune donnée existante n'est modifiée.
alter table public.objectifs
  add column if not exists mode      text not null default 'manuel' check (mode in ('auto','manuel')),
  add column if not exists sexe      text check (sexe in ('h','f')),
  add column if not exists naissance smallint check (naissance between 1900 and 2100),   -- année
  add column if not exists taille    smallint check (taille between 100 and 250),        -- cm
  add column if not exists activite  numeric(4,3) check (activite between 1.1 and 2.0),  -- facteur d'activité
  add column if not exists rythme    numeric(3,2) check (rythme between 0 and 1.0);      -- kg perdus par semaine
