-- Removes everything scripts/demo-mml.sql created and lets Sheets push again.
begin;
delete from visit_books  where visit_id in (select id from visits where note like '[DEMO]%');
delete from visit_answers where visit_id in (select id from visits where note like '[DEMO]%');
delete from visits where note like '[DEMO]%';
-- dirty, so the next push rewrites the spreadsheet from the real data
update sheets_sync set paused = false, dirty = true where id;
commit;
select count(*) || ' demo visits left' from visits where note like '[DEMO]%';
