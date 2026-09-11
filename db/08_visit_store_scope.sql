-- A manager could log a visit against any store id, including one in another
-- territory. The insert only checked who they were, never where they were.
-- Worse, the visit list joins stores, so such a row became invisible to its own
-- author: saved, but gone.
--
-- Referencing `stores` here re-applies s_read, so the check is exactly
-- "a store you can see" — no second copy of the territory rule to drift.

drop policy if exists v_insert on visits;
create policy v_insert on visits for insert
  with check (
    manager_id = current_user_id()
    and store_id in (select id from stores)
  );
