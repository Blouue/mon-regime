-- Annule 20261126100000_suivi_kcal : le mode « sans calories » n'est finalement pas utilisé.
-- La colonne ne contenait que la valeur par défaut (aucune donnée perdue).
alter table public.objectifs drop column if exists suivi_kcal;
