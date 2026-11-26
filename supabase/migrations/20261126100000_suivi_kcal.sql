-- Réglage par compte : suit-on ses calories (Yazio ou autre) ou seulement le poids et les pas ?
-- Ajout uniquement ; les comptes existants gardent le suivi des calories.
alter table public.objectifs
  add column if not exists suivi_kcal boolean not null default true;
