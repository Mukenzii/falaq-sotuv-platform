-- State for the automatic push to Google Sheets.
--
-- A visit must reach the spreadsheet on its own, but the manager standing in a
-- shop must never wait for Google, and must never see their visit fail because
-- Sheets was slow. So the write happens after the response, and this row is
-- what remembers that it still owes one.

create table if not exists sheets_sync (
  id            boolean primary key default true check (id),
  dirty         boolean not null default false,  -- something changed since the last good push
  dirty_since   timestamptz,
  running_until timestamptz,                     -- lease, so two pushes never interleave
  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz,
  -- Kill switch. The test suite creates and deletes visits against the same
  -- database, and without this every run would push its fixtures into the real
  -- company spreadsheet. Also useful while the sheet is being reorganised.
  paused        boolean not null default false
);
insert into sheets_sync (id) values (true) on conflict do nothing;

-- Only the background job touches this, through asSystem.
revoke all on sheets_sync from falaq_app;
