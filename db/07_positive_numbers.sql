-- A shop cannot be -29.5 m wide, and two negatives multiply into a positive
-- area_m2, so a bad row would look valid to every report downstream.
-- The database is the last line: the form and the API check too.

alter table visits drop constraint if exists visits_width_positive;
alter table visits drop constraint if exists visits_height_positive;
alter table visits drop constraint if exists visits_cash_nonneg;

alter table visits
  add constraint visits_width_positive  check (width_m  is null or width_m  > 0),
  add constraint visits_height_positive check (height_m is null or height_m > 0),
  add constraint visits_cash_nonneg     check (cash_collected is null or cash_collected >= 0);
