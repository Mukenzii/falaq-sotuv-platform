-- PostgreSQL 16. Hierarchy is enforced by RLS, driven by the app.user_id session var.

create extension if not exists pgcrypto;

create type user_role    as enum ('direktor','sotuv_boshligi','hudud_rahbari','sotuv_manager');
create type visit_facing as enum ('face','qisman_face','koreshok');
create type book_status  as enum ('present','stale');

create table users (
  id                uuid primary key default gen_random_uuid(),
  -- The login. Lowercase, unique case-insensitively (users_username_key).
  -- NULL means the account exists but nobody can sign in to it yet.
  username          text,
  -- scrypt, lib/password.ts. NULL means no password and no way in.
  password_hash     text,
  must_change_password boolean not null default false,
  password_set_at   timestamptz,
  failed_logins     integer not null default 0,
  locked_until      timestamptz,
  -- A note, not an identity: Telegram stopped being the way in (db/29).
  telegram_id       bigint unique,
  telegram_username text,
  full_name         text not null,
  phone             text unique,
  email             text unique,
  role              user_role not null default 'sotuv_manager',
  parent_id         uuid references users(id) on delete set null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint no_self_parent check (id <> parent_id),
  constraint users_username_shape
    check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$')
);
create index on users(parent_id);
create unique index users_username_key on users (lower(username));

create or replace function current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

create or replace function descendants(root uuid)
returns table(id uuid) language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select u.id from users u where u.id = root
    union all
    select c.id from users c join tree t on c.parent_id = t.id
  ) select id from tree;
$$;

create or replace function my_team() returns setof uuid
language sql stable as $$ select id from descendants(current_user_id()); $$;

create table stores (
  id               bigserial primary key,
  code             text not null unique,
  name             text not null,
  region           text not null,
  channel          text,
  letter_code      text,
  owner_id         uuid references users(id) on delete set null,
  visit_every_days int not null default 14,
  active           boolean not null default true
);
create index on stores(owner_id);
create index on stores(region);

create table books (
  id     bigserial primary key,
  title  text not null unique,
  active boolean not null default true
);

create table visits (
  id              uuid primary key default gen_random_uuid(),
  manager_id      uuid not null references users(id),
  store_id        bigint not null references stores(id),
  visited_at      timestamptz not null default now(),
  width_m         numeric(5,2),
  height_m        numeric(5,2),
  area_m2         numeric(7,2) generated always as (width_m * height_m) stored,
  open_from       time,
  open_to         time,
  placement       text[],
  facing          visit_facing,
  shelf_heights   text[],
  visit_result    text[],
  took_order      boolean generated always as ('Buyurtma oldim' = any(visit_result)) stored,
  no_order_reason text,
  debt_status     text,
  cash_collected  numeric(14,2),
  note            text,
  lat             numeric(9,6),
  lng             numeric(9,6),
  created_at      timestamptz not null default now()
);
create index on visits(manager_id, visited_at desc);
create index on visits(store_id, visited_at desc);

create table visit_books (
  visit_id uuid not null references visits(id) on delete cascade,
  book_id  bigint not null references books(id),
  status   book_status not null,
  primary key (visit_id, book_id, status)
);

create table visit_photos (
  id           bigserial primary key,
  visit_id     uuid not null references visits(id) on delete cascade,
  object_key   text not null,
  content_type text,
  bytes        int,
  created_at   timestamptz not null default now()
);

-- force: without it RLS is skipped for the table owner, silently disabling the hierarchy
alter table users        enable row level security; alter table users        force row level security;
alter table stores       enable row level security; alter table stores       force row level security;
alter table visits       enable row level security; alter table visits       force row level security;
alter table visit_books  enable row level security; alter table visit_books  force row level security;
alter table visit_photos enable row level security; alter table visit_photos force row level security;
alter table books        enable row level security; alter table books        force row level security;

create policy s_read on stores for select
  using (owner_id is null or owner_id in (select my_team()));

create policy v_read   on visits for select using (manager_id in (select my_team()));
create policy v_insert on visits for insert with check (manager_id = current_user_id());
create policy v_update on visits for update
  using (manager_id = current_user_id() and visited_at > now() - interval '24 hours');

create policy vb_all on visit_books for all
  using      (visit_id in (select id from visits))
  with check (visit_id in (select id from visits where manager_id = current_user_id()));

create policy vp_all on visit_photos for all
  using      (visit_id in (select id from visits))
  with check (visit_id in (select id from visits where manager_id = current_user_id()));

create policy b_read on books for select using (true);

create view v_bugungi_reja as
select s.id as store_id, s.code, s.region, s.owner_id,
       max(v.visited_at) as oxirgi_vizit,
       coalesce(date_part('day', now() - max(v.visited_at))::int, 999) as kun_otdi,
       s.visit_every_days
from stores s left join visits v on v.store_id = s.id
where s.active group by s.id
having coalesce(date_part('day', now() - max(v.visited_at))::int, 999) >= s.visit_every_days;

create view v_manager_kunlik as
select u.id as manager_id, u.full_name, date_trunc('day', v.visited_at) as kun,
       count(v.id) as vizitlar,
       count(*) filter (where v.took_order) as buyurtmalar,
       sum(v.cash_collected) as yigilgan_pul
from users u left join visits v on v.manager_id = u.id
where u.role = 'sotuv_manager' group by 1,2,3;

create view v_turib_qolgan as
select b.title, s.region, count(*) as marta, max(v.visited_at) as oxirgi
from visit_books vb
join visits v on v.id = vb.visit_id
join books  b on b.id = vb.book_id
join stores s on s.id = v.store_id
where vb.status = 'stale' and v.visited_at > now() - interval '90 days'
group by 1,2 order by marta desc;
