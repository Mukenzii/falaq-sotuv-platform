-- Brings the platform to exact parity with the live Google Form
-- "Sotuv Manager - Bekzod", read from FB_PUBLIC_LOAD_DATA_ on 2026-09-07.
-- The earlier CSV only showed values someone had *selected*, so several
-- options were never visible and are added here.

-- Kitoblarimiz qanday turibdi? had a fourth answer we were missing.
alter type visit_facing add value if not exists 'qutida';

-- 5 titles present in the form's picker but absent from the seed.
insert into books (title) values
  ('Boshlang''ich Arab tili alifbosi'),
  ('Boshlang''ich Arab tili alifbosi (2)'),
  ('Ikki qariya'),
  ('Omonat'),
  ('Sehrlangan G''or')
on conflict (title) do nothing;
