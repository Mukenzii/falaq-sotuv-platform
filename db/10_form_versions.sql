-- The form becomes a versioned document.
--
-- form_blocks was a live table the respondent form read directly, so an admin
-- editing a question changed what every past response meant. A response has to
-- stay readable under the form it was actually filled under, and an admin has to
-- be able to work on a draft without pushing half-finished questions at the
-- managers. Both need whole-form versions, so the form is now one jsonb document
-- per version and `visits.form_version` records which one a response used.
--
-- Shape of `doc` is lib/form/types.ts (FormDoc). Postgres does not validate it;
-- the API does, on the way in.

create table form_versions (
  id           bigserial primary key,
  version      int not null unique,
  status       text not null check (status in ('draft', 'published', 'archived')),
  doc          jsonb not null,
  -- bumped on every draft save. Two admins editing at once are detected by
  -- comparing this, not a timestamp: timestamps collide inside one millisecond
  -- and the loser's work would vanish without anyone being told.
  rev          bigint not null default 1,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references users(id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now()
);

-- exactly one draft and one published version at any moment; the rest archive
create unique index one_draft     on form_versions ((status)) where status = 'draft';
create unique index one_published on form_versions ((status)) where status = 'published';

alter table form_versions enable row level security;
alter table form_versions force row level security;

-- everyone filling the form needs the published version; only an admin writes
create policy fv_read  on form_versions for select using (current_user_id() is not null);
create policy fv_write on form_versions for all
  using (can_manage_users()) with check (can_manage_users());

-- Which version a response was filled under. Existing rows predate versioning
-- and all used the seeded form, which becomes version 1.
--
-- security definer, not cosmetic: the default is evaluated as whoever inserts,
-- and a script running as the owner has no app.user_id, so fv_read would hide
-- every row and the column would silently default to NULL.
create or replace function current_form_version() returns int
language sql stable security definer set search_path = public as $$
  select version from form_versions where status = 'published' limit 1;
$$;

alter table visits add column form_version int;
update visits set form_version = 1;
-- a literal 1 would outlive version 1 itself, leaving responses pointing at a
-- version that publishing has since archived away
alter table visits alter column form_version set default current_form_version();

/* ---------- carry form_blocks across, in order ---------- */

do $$
declare
  b            record;
  sections     jsonb := '[]'::jsonb;
  cur_blocks   jsonb := '[]'::jsonb;
  cur_id       text  := 's_1';
  cur_title    text  := '';
  n_sec        int   := 1;
  block        jsonb;
  qtype        text;
  opts         jsonb;
  doc          jsonb;
begin
  for b in select * from form_blocks order by position, id loop
    if b.kind = 'section' then
      -- close the section being built and start a new one after it
      sections := sections || jsonb_build_array(jsonb_build_object(
        'id', cur_id, 'title', cur_title, 'description', '',
        'next', jsonb_build_object('type', 'continue'), 'blocks', cur_blocks));
      n_sec      := n_sec + 1;
      cur_id     := 's_' || b.id;
      cur_title  := b.label;
      cur_blocks := '[]'::jsonb;
      continue;
    end if;

    if b.kind = 'core' then
      qtype := case b.core_key
        when 'store_id'        then 'dropdown'
        when 'width_m'         then 'short_answer'
        when 'height_m'        then 'short_answer'
        when 'open_from'       then 'time'
        when 'open_to'         then 'time'
        when 'placement'       then 'checkboxes'
        when 'facing'          then 'multiple_choice'
        when 'shelf_heights'   then 'checkboxes'
        when 'photos'          then 'file_upload'
        when 'present_books'   then 'checkboxes'
        when 'stale_books'     then 'checkboxes'
        when 'visit_result'    then 'checkboxes'
        when 'no_order_reason' then 'multiple_choice'
        when 'debt_status'     then 'multiple_choice'
        when 'cash_collected'  then 'short_answer'
        when 'note'            then 'paragraph'
      end;
      block := jsonb_strip_nulls(jsonb_build_object(
        'id', 'core_' || b.core_key, 'kind', 'question', 'coreKey', b.core_key,
        'type', qtype, 'title', b.label, 'description', b.help,
        'required', b.required, 'hidden', b.hidden));

    elsif b.kind = 'custom' then
      -- the old `number` type had no equivalent; it becomes a short answer
      -- carrying a numeric validation rule, which is how Forms does it too
      qtype := case b.answer_type
        when 'short_text'  then 'short_answer'
        when 'long_text'   then 'paragraph'
        when 'number'      then 'short_answer'
        when 'one_choice'  then 'multiple_choice'
        when 'multi_choice'then 'checkboxes'
        when 'date'        then 'date'
        else 'short_answer'
      end;
      select coalesce(jsonb_agg(jsonb_build_object('id', 'o_' || b.id || '_' || o.i, 'label', o.v)
                                order by o.i), '[]'::jsonb)
        into opts
        from unnest(b.options) with ordinality as o(v, i);

      block := jsonb_strip_nulls(jsonb_build_object(
        'id', 'q_' || b.id, 'kind', 'question', 'type', qtype,
        'title', b.label, 'description', b.help,
        'required', b.required, 'hidden', b.hidden,
        'options', case when b.answer_type in ('one_choice', 'multi_choice') then opts else null end,
        'validation', case when b.answer_type = 'number'
                           then jsonb_build_object('kind', 'number') else null end));

    elsif b.kind = 'text' then
      block := jsonb_build_object('id', 't_' || b.id, 'kind', 'text',
                                  'title', b.label, 'description', coalesce(b.help, ''));
    elsif b.kind = 'image' then
      block := jsonb_build_object('id', 'i_' || b.id, 'kind', 'image',
                                  'title', b.label, 'imageKey', b.image_key);
    else
      continue;
    end if;

    cur_blocks := cur_blocks || jsonb_build_array(block);
  end loop;

  sections := sections || jsonb_build_array(jsonb_build_object(
    'id', cur_id, 'title', cur_title, 'description', '',
    'next', jsonb_build_object('type', 'continue'), 'blocks', cur_blocks));

  doc := jsonb_build_object(
    'schemaVersion', 2,
    'title', 'Do''kon vizit',
    'description', 'Do''kondagi holatni belgilang.',
    -- The 359 responses already in this table were written against one scrolling
    -- page and the managers know it that way, so the migrated form keeps that.
    -- Section paging is a setting, not a rewrite: switch it in Sozlamalar.
    'settings', jsonb_build_object(
      'pagination', 'single', 'showProgress', true,
      'confirmText', 'Vizit saqlandi'),
    'sections', sections);

  insert into form_versions (version, status, doc, published_at)
    values (1, 'published', doc, now());
  insert into form_versions (version, status, doc)
    values (2, 'draft', doc);
end $$;

/* ---------- answers key off the document, not a row id ---------- */

-- visit_answers.block_id pointed at form_blocks, which is going away. Block ids
-- are now strings that live in the document and survive every edit.
alter table visit_answers drop constraint visit_answers_pkey;
alter table visit_answers add column block_key text;
update visit_answers set block_key = 'q_' || block_id;
alter table visit_answers drop column block_id;
alter table visit_answers alter column block_key set not null;
alter table visit_answers add primary key (visit_id, block_key);

drop table form_blocks;
drop type block_kind;
drop type answer_type;

-- /api/uploads/view has to let a form illustration through without it being
-- attached to any visit. Reading them out of the document keeps that check in
-- one place instead of every route that renders an image.
create or replace function form_image_keys() returns setof text
language sql stable as $$
  select b->>'imageKey'
    from form_versions fv
    cross join lateral jsonb_array_elements(fv.doc -> 'sections') sec
    cross join lateral jsonb_array_elements(sec -> 'blocks') b
   where b ->> 'imageKey' is not null;
$$;
