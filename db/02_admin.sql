-- Admin rights. Komil = direktor: sees everything, manages all users.

-- security definer is required, not cosmetic: u_read calls my_role(), which reads
-- users, which re-evaluates u_read. Running as the owner (BYPASSRLS) breaks the loop.
create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from users where id = current_user_id();
$$;

create or replace function can_manage_users() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('direktor','sotuv_boshligi'), false);
$$;

drop policy if exists u_read on users;
create policy u_read on users for select
  using (my_role() = 'direktor' or id in (select my_team()));

drop policy if exists u_insert on users;
create policy u_insert on users for insert
  with check (can_manage_users());

drop policy if exists u_update on users;
create policy u_update on users for update
  using      (can_manage_users() or id = current_user_id())
  with check (can_manage_users() or id = current_user_id());

drop policy if exists u_delete on users;
create policy u_delete on users for delete
  using (can_manage_users() and id <> current_user_id());

drop policy if exists s_write on stores;
create policy s_write on stores for all
  using (can_manage_users()) with check (can_manage_users());
drop policy if exists b_write on books;
create policy b_write on books for all
  using (can_manage_users()) with check (can_manage_users());

-- Stops the last direktor from being deleted, demoted or deactivated,
-- which would lock everyone out of the system permanently.
create or replace function guard_last_direktor() returns trigger
language plpgsql as $$
declare remaining int;
begin
  select count(*) into remaining
  from users where role = 'direktor' and active and id <> old.id;

  if tg_op = 'DELETE' and old.role = 'direktor' and remaining = 0 then
    raise exception 'Oxirgi direktorni o''chirib bo''lmaydi';
  end if;

  if tg_op = 'UPDATE' and old.role = 'direktor'
     and (new.role <> 'direktor' or not new.active) and remaining = 0 then
    raise exception 'Oxirgi direktorni pasaytirib yoki faolsizlantirib bo''lmaydi';
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists trg_guard_last_direktor on users;
create trigger trg_guard_last_direktor
  before update or delete on users
  for each row execute function guard_last_direktor();
