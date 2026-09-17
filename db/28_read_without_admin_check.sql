-- Every read in the app was calling can_manage_users() once per row.
--
-- The write policies were written `for all`. In Postgres, `ALL` includes
-- SELECT, and permissive policies of the same command are OR'd — so reading
-- `stores` evaluated
--
--     can_manage_users() OR current_user_id() is not null
--
-- per row, and can_manage_users() is a SECURITY DEFINER function that queries
-- `users`. A STABLE function is not cached across rows, so a 758-row scan of
-- stores meant 758 lookups, and the planner puts the expensive side first.
--
-- Measured on the MML page, which reads the whole store x must-list matrix:
--   v_mml_book   700ms -> 10.8ms
--   v_mml        845ms -> 82ms
--   /api/mml     3.5s  -> well under a second
--
-- This is not an MML fix. Every list in the app was paying it.
--
-- Each of these tables already has its own SELECT policy, so restricting the
-- write policy to the three write commands takes nothing away from readers.
-- Write behaviour is unchanged: `for all` applies USING to UPDATE and DELETE
-- row selection and WITH CHECK to INSERT and UPDATE, which is exactly what the
-- three replacements say.
--
-- Not touched: va_all, vb_all and vp_all on the visit tables. Their USING
-- clause IS the read rule there, so splitting them would buy nothing.

do $$
declare t text;
begin
  foreach t in array array[
    'book_aliases', 'books', 'form_versions', 'mml_weights',
    'plan_rule_skips', 'plan_rules', 'regions', 'stores', 'week_plans'
  ] loop
    execute format('drop policy if exists %I on %I', left(t, 2) || '_write', t);
    execute format('drop policy if exists %I on %I', t || '_write_ins', t);
    execute format('drop policy if exists %I on %I', t || '_write_upd', t);
    execute format('drop policy if exists %I on %I', t || '_write_del', t);
    execute format(
      'create policy %I on %I for insert with check (can_manage_users())', t || '_write_ins', t);
    execute format(
      'create policy %I on %I for update using (can_manage_users()) with check (can_manage_users())',
      t || '_write_upd', t);
    execute format(
      'create policy %I on %I for delete using (can_manage_users())', t || '_write_del', t);
  end loop;
end $$;

-- the policy names did not follow the first two letters of the table
drop policy if exists ba_write on book_aliases;
drop policy if exists b_write  on books;
drop policy if exists fv_write on form_versions;
drop policy if exists mw_write on mml_weights;
drop policy if exists prs_write on plan_rule_skips;
drop policy if exists pr_write on plan_rules;
drop policy if exists r_write  on regions;
drop policy if exists s_write  on stores;
drop policy if exists wp_write on week_plans;

-- store_stock keeps its own rule (an admin, or a shop on your team's books);
-- it is only the SELECT half that had to go
drop policy if exists ss_write on store_stock;
drop policy if exists ss_write_ins on store_stock;
drop policy if exists ss_write_upd on store_stock;
drop policy if exists ss_write_del on store_stock;
create policy ss_write_ins on store_stock for insert
  with check (can_manage_users() or store_id in (
    select id from stores where owner_id in (select my_team())));
create policy ss_write_upd on store_stock for update
  using (can_manage_users() or store_id in (
    select id from stores where owner_id in (select my_team())))
  with check (can_manage_users() or store_id in (
    select id from stores where owner_id in (select my_team())));
create policy ss_write_del on store_stock for delete
  using (can_manage_users() or store_id in (
    select id from stores where owner_id in (select my_team())));
