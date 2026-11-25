-- Suivi de l'eau et du ressenti, et nouvelle source « export » (import de l'export Apple Santé).
-- Ajouts uniquement : aucune donnée existante n'est modifiée.
alter table public.jours
  add column if not exists eau     smallint check (eau between 0 and 30),       -- verres de 25 cl
  add column if not exists faim    smallint check (faim between 1 and 5),
  add column if not exists energie smallint check (energie between 1 and 5),
  add column if not exists humeur  smallint check (humeur between 1 and 5);

alter table public.jours drop constraint if exists jours_source_check;
alter table public.jours add constraint jours_source_check
  check (source in ('raccourci','collage','manuel','export'));
