-- Komil edits the visit form itself.
--
-- The 16 original questions stay as typed columns on `visits` — that is what the
-- dashboards, the Sheets export and the enum checks are built on. They appear
-- here as `core` blocks so they can be renamed, reordered, made optional or
-- hidden, but never deleted and never retyped.
--
-- Anything Komil adds is a `custom` block and its answers land in visit_answers
-- as jsonb, which costs nothing until someone actually adds a question.

create type block_kind as enum ('core', 'custom', 'section', 'text', 'image');
create type answer_type as enum ('short_text', 'long_text', 'number', 'one_choice', 'multi_choice', 'date');

create table form_blocks (
  id          bigserial primary key,
  kind        block_kind not null,
  -- set for kind='core' only: names the typed column this block drives
  core_key    text unique,
  label       text not null,
  help        text,
  answer_type answer_type,
  options     text[] not null default '{}',
  required    boolean not null default false,
  hidden      boolean not null default false,
  position    int not null,
  image_key   text,                      -- kind='image': a MinIO object key
  created_at  timestamptz not null default now(),

  constraint core_has_key check ((kind = 'core') = (core_key is not null)),
  constraint custom_has_type check (kind <> 'custom' or answer_type is not null)
);
create index on form_blocks(position);

create table visit_answers (
  visit_id uuid not null references visits(id) on delete cascade,
  block_id bigint not null references form_blocks(id) on delete cascade,
  value    jsonb not null,
  primary key (visit_id, block_id)
);

alter table form_blocks   enable row level security; alter table form_blocks   force row level security;
alter table visit_answers enable row level security; alter table visit_answers force row level security;

-- everyone filling the form needs to read it; only an admin may change it
create policy fb_read  on form_blocks for select using (current_user_id() is not null);
create policy fb_write on form_blocks for all
  using (can_manage_users()) with check (can_manage_users());

-- answers follow their visit, exactly like visit_books
create policy va_all on visit_answers for all
  using      (visit_id in (select id from visits))
  with check (visit_id in (select id from visits where manager_id = current_user_id()));

-- The form as it stands today, in the order managers already know.
insert into form_blocks (kind, core_key, label, required, position) values
  ('core', 'store_id',        'Do''kon',                                                  true,  10),
  ('core', 'width_m',         'Eni (m)',                                                  true,  30),
  ('core', 'height_m',        'Bo''yi (m)',                                               true,  40),
  ('core', 'open_from',       'Ochilish',                                                 true,  50),
  ('core', 'open_to',         'Yopilish',                                                 true,  60),
  ('core', 'placement',       'Do''konga kirganda kitoblarimiz qayerda joylashgan?',      true,  80),
  ('core', 'facing',          'Kitoblarimiz qanday turibdi?',                             true,  90),
  ('core', 'shelf_heights',   'Javonning qaysi qismida turibdi?',                         true, 100),
  ('core', 'photos',          'Javon yoki do''kon rasmi',                                 true, 120),
  ('core', 'present_books',   'Qaysi kitoblarimiz turibdi?',                              true, 140),
  ('core', 'stale_books',     'Qaysi kitoblar turib qolgan (1 oydan beri sotilmayapti)?', false,150),
  ('core', 'visit_result',    'Vizit natijasi',                                           true, 170),
  ('core', 'no_order_reason', 'Buyurtma bo''lmasa, sababi',                               false,180),
  ('core', 'debt_status',     'Qarzdorlik holati',                                        true, 190),
  ('core', 'cash_collected',  'Bugun yig''ilgan pul (so''m)',                             false,200),
  ('core', 'note',            'Shikoyat yoki taklif',                                     false,210);

insert into form_blocks (kind, label, position) values
  ('section', 'Do''kon',   20),
  ('section', 'Javon',     70),
  ('section', 'Rasm',     110),
  ('section', 'Kitoblar', 130),
  ('section', 'Natija',   160);
