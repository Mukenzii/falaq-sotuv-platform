-- The name of each region's tab in the spreadsheet, kept apart from its name.
--
-- Until now the tab was titled with regions.name, so the tab and the "Hudud"
-- column were forced to be the same words. The team's tabs are not named that
-- way: they are "01 Toshkent", "10 Toshkent", "20 Sirdaryo" — the store-code
-- prefix and a short name, which sorts the tabs in code order and matches how
-- everyone reads a store code by eye.
--
-- That naming cannot be derived from the name, and the reason is the first two
-- rows: "Toshkent shahri" and "Toshkent viloyati" are both "Toshkent" on a tab,
-- told apart only by the 01 and the 10 in front. So it is stored.
--
-- These titles must match the tabs that already exist, letter for letter. The
-- writer creates a tab it cannot find, so a title that is one space or one
-- apostrophe out does not fail loudly — it quietly grows a second, nearly
-- identical tab beside the real one. Check them against the spreadsheet.

alter table regions add column if not exists tab_title text;

update regions set tab_title = v.tab_title
  from (values
    ('01', '01 Toshkent'),
    ('10', '10 Toshkent'),
    ('20', '20 Sirdaryo'),
    ('25', '25 Jizzax'),
    ('30', '30 Samarqand'),
    ('40', '40 Farg''ona'),
    ('50', '50 Namangan'),
    ('60', '60 Andijon'),
    ('70', '70 Qashqadaryo'),
    ('75', '75 Surxandaryo'),
    ('80', '80 Buxoro'),
    ('85', '85 Navoiy'),
    ('90', '90 Xorazm'),
    ('95', '95 Qoraqalpog''iston')
  ) as v(code, tab_title)
 where regions.code = v.code
   -- only fill a blank: a title corrected by hand to match the real tab must
   -- survive this file being replayed
   and regions.tab_title is null;

-- A region added later without one would silently stop having a tab, so fall
-- back to "<code> <name>" rather than leaving it null.
update regions set tab_title = code || ' ' || name where tab_title is null;

alter table regions alter column tab_title set not null;
alter table regions drop constraint if exists regions_tab_title_key;
alter table regions add constraint regions_tab_title_key unique (tab_title);

comment on column regions.tab_title is
  'Exact title of this region''s tab in the visits spreadsheet. Must match the '
  'tab letter for letter — writeVisitTabs() creates any title it cannot find, '
  'so a mismatch makes a duplicate tab rather than an error.';
