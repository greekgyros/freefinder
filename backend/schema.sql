-- FreeFinder backend for Supabase.
--
-- Paste this whole file into Supabase -> SQL Editor -> Run. It is safe to run
-- again after changes (it never deletes data or regenerates the code secret).
--
-- Layout:
--   schema ff      private: tables, helpers and admin tools. Not reachable
--                  from the browser (the Data API only exposes "public").
--   public.ff_*    the API. SECURITY DEFINER functions the site calls via
--                  /rest/v1/rpc/ff_*. Every one that acts on an account takes
--                  that account's three-word code as p_code.
--
-- Every API function returns jsonb: either the result, or {"error": "..."}.
-- Errors are returned rather than raised so that failed-code attempts are
-- still recorded for rate limiting (a raise would roll the insert back).

create schema if not exists ff;

-- ---------------------------------------------------------------- tables ---

create table if not exists ff.accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  code_hash  text not null unique,
  free       text[] not null default '{}',  -- slot keys like 'A-Mon-L'
  created_at timestamptz not null default now()
);

-- viewer asked to see owner's frees. Only 'approved' rows grant visibility.
create table if not exists ff.follows (
  viewer_id  uuid not null references ff.accounts(id) on delete cascade,
  owner_id   uuid not null references ff.accounts(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  primary key (viewer_id, owner_id),
  check (viewer_id <> owner_id)
);
create index if not exists follows_owner_idx on ff.follows (owner_id);

-- Rate limiting: wrong codes and sign-ups per IP.
create table if not exists ff.attempts (
  ip   text not null,
  kind text not null,
  at   timestamptz not null default now()
);
create index if not exists attempts_idx on ff.attempts (ip, kind, at);

-- Secret mixed into code hashes, so a leaked table can't be brute-forced
-- offline. Generated once; never change it or every code stops working.
create table if not exists ff.settings (
  key   text primary key,
  value bytea not null
);
insert into ff.settings (key, value)
values ('code_pepper', uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()))
on conflict (key) do nothing;

create table if not exists ff.words (word text primary key);
insert into ff.words (word)
select w from regexp_split_to_table(btrim($words$
able acid acorn acre actor adult agent alarm album alert alley amber anchor
angle ankle anvil apple apron arch arena armor arrow aspen atlas attic audio
autumn avocado award axis bacon badge bagel baker bamboo banjo barn barrel
basin basket beach beacon beam bean beard beetle bell belt bench berry bike
bird biscuit bison blade blanket blaze blend blimp bloom board boat bobcat
bolt bonsai bonus book boot bottle boulder bowl box bramble branch brave
bread breeze brick bridge brook broom brush bubble bucket buddy buffalo
bugle bunny butter button cabbage cabin cable cactus cake camel camera camp
canal canary candle candy canoe canvas canyon cape caramel carbon card cargo
carpet carrot cashew castle cattle cave cedar cello chalet chalk chart
cheese cherry chess chest chick chimney chip cider cinema circle city clam
clay cliff clock cloud clover coach coast coat cobalt cobra cocoa coconut
coffee coin comet comic compass condor cookie copper coral cord corn cosmos
cotton couch cousin crab cranberry crane crayon cream creek crest cricket
crown crumb crystal cube cupcake curtain cushion cycle cypress dahlia daisy
dance dawn deck deer delta denim desert desk diary diesel dingo dinner disco
dock dolphin dome donkey door dove dragon dragonfly drawer dream drift
driftwood drum duck dune eagle echo edge eel elbow elm ember emerald engine
envelope eraser event fabric falcon fancy farm feast feather fence fern
ferry fiddle field fig film finch fire fjord flag flame flamingo flute foam
focus fog forest fork fossil fountain fox frame frost fruit fudge galaxy
garden garlic gate gecko gem geyser giant ginger gingko giraffe glacier
glass glider globe glove goat gold gondola goose gorilla grain granite grape
grass gravel guitar gull gumdrop habit hammer hammock hamster harbor harp
hat hawk hazel hazelnut heart hedge hedgehog helmet herb heron hill hilltop
hive honey hood hook hopscotch horizon horn horse hotel house iceberg igloo
island ivory ivy jacket jade jaguar jam jar jasmine jelly jet jewel jigsaw
journal juice jungle juniper kayak kestrel kettle key kiln kite kitten kiwi
knot koala ladder lagoon lake lamp lantern laptop latte lava lavender lawn
leaf lemon lemonade lens lever library lighthouse lilac lily lime linen lion
lizard llama lobster locket lodge loft lotus lunar lunch lynx magnet magpie
mandolin mango maple marble marigold market marmot meadow meerkat melon
mermaid meteor minnow mint mirror mitten mole monkey moon moose mosaic moss
moth motor mountain muffin mug museum mushroom music nectar needle nest
nickel noodle north nugget nutmeg oak oasis ocean ocelot olive onion opal
orange orbit orchard orchid ostrich otter oven owl oyster paddle pagoda
paint palace palm panda pansy paper paprika parade parcel parrot parsnip
pasta patch path peach peacock peanut pear pebble pelican pencil penguin
pepper piano pickle pigeon pillow pilot pine pinecone pirate pizza planet
plank plover plum pocket poem polar pond pony popcorn poppy porcupine portal
potato pottery pretzel prism puffin pumpkin puppet puzzle quail quartz quest
quill quilt quokka rabbit raccoon radar radio radish raft rain rainbow raven
redwood reef rhubarb ribbon rice ridge river robin robot rocket rooster rope
rose ruby rudder saddle saffron sail salad salmon sand sandal satchel saucer
scarf school scooter sea seal seashell seed sequoia shadow shark shelf shell
sherbet shield ship shoe shore signal silk silver skate sketch ski sky sled
slope snail snow snowflake soap sock sofa sorbet soup spade spark sparrow
sphinx spice spider spinach spoon spring sprout spruce squid squirrel stable
stage star starfish station statue steam stone storm straw stream street
sugar summer sun sundial sunflower swan sweater swing sword table taco
tadpole tail tango tapestry teapot temple tent thimble thistle thunder tiger
timber toast tomato topaz torch toucan tower toy tractor trail train tree
treehouse tripod trophy trumpet tulip tundra tunnel turnip turtle tusk twig
umbrella unicorn valley vase velvet violet violin volcano waffle wagon
walkway wallaby walnut walrus wand waterfall wave whale wheat wheel whisk
wigwam wildflower willow window wing winter wizard wolf woodpecker wool
yacht yak yarn yeti yogurt zebra zinc zipper
$words$, E' \n\r\t'), '\s+') as w
on conflict (word) do nothing;

alter table ff.accounts enable row level security;
alter table ff.follows  enable row level security;
alter table ff.attempts enable row level security;
alter table ff.settings enable row level security;
alter table ff.words    enable row level security;

-- --------------------------------------------------------------- helpers ---

-- Canonical 'apple.river.stone' if the text is three list words, else null.
-- Accepts any case, spaces/dots/dashes/slashes between words, and a '///' prefix.
create or replace function ff.parse_code(p_text text) returns text
language sql stable set search_path = '' as $$
  select case when count(*) = 3 and bool_and(w.word is not null)
              then string_agg(t.part, '.' order by t.n) end
  from unnest(regexp_split_to_array(lower(btrim(coalesce(p_text, ''))), '[[:space:].,_/\\-]+'))
       with ordinality as t(part, n)
  left join ff.words w on w.word = t.part
  where t.part <> ''
$$;

create or replace function ff.hash_code(p_code text) returns text
language sql stable set search_path = '' as $$
  select encode(sha256(s.value || convert_to(p_code, 'UTF8')), 'hex')
  from ff.settings s where s.key = 'code_pepper'
$$;

create or replace function ff.generate_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  words text[];
  n int;
  b bytea := uuid_send(gen_random_uuid());  -- bytes 0-5 are fully random
  parts text[] := '{}';
begin
  select array_agg(word order by word) into words from ff.words;
  n := array_length(words, 1);
  for i in 0..2 loop
    parts := parts || words[1 + ((get_byte(b, i * 2) * 256 + get_byte(b, i * 2 + 1)) % n)];
  end loop;
  return array_to_string(parts, '.');
end $$;

-- Account id for a code (any accepted spelling), or null.
create or replace function ff.lookup(p_code text) returns uuid
language sql stable set search_path = '' as $$
  select a.id from ff.accounts a where a.code_hash = ff.hash_code(ff.parse_code(p_code))
$$;

create or replace function ff.clean_name(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case when char_length(n) between 1 and 40 then n end
  from (select regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g') as n) x
$$;

-- Keep only valid slot keys: week A/B, Mon-Sat, periods 1-6 plus L (lunch,
-- between P4 and P5) and AS (after school). Must match frontend/config.js.
create or replace function ff.clean_free(p_free text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct k order by k), '{}')
  from unnest(coalesce(p_free, '{}')) as k
  where k ~ '^[AB]-(Mon|Tue|Wed|Thu|Fri|Sat)-(1|2|3|4|L|5|6|AS)$'
$$;

create or replace function ff.client_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
    split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1),
    'unknown')
$$;

create or replace function ff.too_many(p_kind text, p_limit int, p_window interval) returns boolean
language sql stable set search_path = '' as $$
  select count(*) >= p_limit from ff.attempts
  where ip = ff.client_ip() and kind = p_kind and at > now() - p_window
$$;

create or replace function ff.note_attempt(p_kind text) returns void
language sql volatile set search_path = '' as $$
  delete from ff.attempts where at < now() - interval '1 day';
  insert into ff.attempts (ip, kind) values (ff.client_ip(), p_kind);
$$;

create or replace function ff.err(p_message text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('error', p_message)
$$;

-- 20 wrong codes per IP per 15 minutes.
create or replace function ff.code_limited() returns boolean
language sql stable set search_path = '' as $$
  select ff.too_many('bad_code', 20, interval '15 minutes')
$$;

-- Look up p_code, recording a failed attempt if it doesn't match.
create or replace function ff.auth(p_code text) returns uuid
language plpgsql volatile set search_path = '' as $$
declare me uuid := ff.lookup(p_code);
begin
  if me is null then perform ff.note_attempt('bad_code'); end if;
  return me;
end $$;

-- Everything an account holder sees about themselves.
--   following: people whose code I entered. free is only included once they approve.
--   viewers:   people who entered my code (pending = asking, approved = can see me).
create or replace function ff.account_json(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'name', a.name,
    'free', to_jsonb(a.free),
    'following', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'name', o.name, 'status', f.status,
               'free', case when f.status = 'approved' then to_jsonb(o.free) end)
             order by lower(o.name))
      from ff.follows f join ff.accounts o on o.id = f.owner_id
      where f.viewer_id = a.id), '[]'::jsonb),
    'viewers', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'status', f.status)
             order by lower(v.name))
      from ff.follows f join ff.accounts v on v.id = f.viewer_id
      where f.owner_id = a.id), '[]'::jsonb))
  from ff.accounts a where a.id = p_id
$$;

-- ------------------------------------------------------------------- API ---

-- The name box. A three-word code signs you in; anything else is a new name.
create or replace function public.ff_login(p_input text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; v_code text := ff.parse_code(p_input); v_name text;
begin
  if v_code is not null then
    if ff.code_limited() then return ff.err('Too many wrong codes. Wait a few minutes and try again.'); end if;
    me := ff.auth(v_code);
    if me is null then
      return ff.err('No account has that code. Check the spelling, or enter your name to start a new one.');
    end if;
    return jsonb_build_object('account', ff.account_json(me) || jsonb_build_object('code', v_code));
  end if;
  v_name := ff.clean_name(p_input);
  if v_name is null then return ff.err('Enter your name (up to 40 characters).'); end if;
  return jsonb_build_object('new', true, 'name', v_name);
end $$;

-- The only place a raw code is ever returned.
create or replace function public.ff_create_account(p_name text, p_free text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text := ff.clean_name(p_name); v_code text; me uuid;
begin
  if v_name is null then return ff.err('Enter your name (up to 40 characters).'); end if;
  if ff.too_many('signup', 10, interval '1 hour') then
    return ff.err('Too many new accounts from here. Try again later.');
  end if;
  loop
    v_code := ff.generate_code();
    exit when not exists (select 1 from ff.accounts where code_hash = ff.hash_code(v_code));
  end loop;
  insert into ff.accounts (name, code_hash, free)
  values (v_name, ff.hash_code(v_code), ff.clean_free(p_free))
  returning id into me;
  perform ff.note_attempt('signup');
  return jsonb_build_object('account', ff.account_json(me) || jsonb_build_object('code', v_code));
end $$;

create or replace function public.ff_get_account(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  if ff.code_limited() then return ff.err('Too many wrong codes. Wait a few minutes and try again.'); end if;
  me := ff.auth(p_code);
  if me is null then return ff.err('Your code wasn''t recognised. Sign in again.'); end if;
  return jsonb_build_object('account', ff.account_json(me));
end $$;

-- Pass null for anything you don't want to change.
create or replace function public.ff_update_account(p_code text, p_name text default null, p_free text[] default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; v_name text;
begin
  if ff.code_limited() then return ff.err('Too many wrong codes. Wait a few minutes and try again.'); end if;
  me := ff.auth(p_code);
  if me is null then return ff.err('Your code wasn''t recognised. Sign in again.'); end if;
  if p_name is not null then
    v_name := ff.clean_name(p_name);
    if v_name is null then return ff.err('Enter your name (up to 40 characters).'); end if;
    update ff.accounts set name = v_name where id = me;
  end if;
  if p_free is not null then
    update ff.accounts set free = ff.clean_free(p_free) where id = me;
  end if;
  return jsonb_build_object('account', ff.account_json(me));
end $$;

-- Deletes the account and every follow/request to or from it.
create or replace function public.ff_delete_account(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  if ff.code_limited() then return ff.err('Too many wrong codes. Wait a few minutes and try again.'); end if;
  me := ff.auth(p_code);
  if me is null then return ff.err('Your code wasn''t recognised. Sign in again.'); end if;
  delete from ff.accounts where id = me;
  return jsonb_build_object('deleted', true);
end $$;

-- Ask to see someone's frees by entering their code. Starts as 'pending'.
create or replace function public.ff_request_follow(p_code text, p_target_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; target uuid;
begin
  if ff.code_limited() then return ff.err('Too many wrong codes. Wait a few minutes and try again.'); end if;
  me := ff.auth(p_code);
  if me is null then return ff.err('Your code wasn''t recognised. Sign in again.'); end if;
  target := ff.auth(p_target_code);
  if target is null then return ff.err('No one has that code. Check the spelling.'); end if;
  if target = me then return ff.err('That''s your own code.'); end if;
  insert into ff.follows (viewer_id, owner_id) values (me, target)
  on conflict (viewer_id, owner_id) do nothing;
  return jsonb_build_object('account', ff.account_json(me));
end $$;

-- Stop following someone, or cancel a request you sent.
create or replace function public.ff_unfollow(p_code text, p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  if ff.code_limited() then return ff.err('Too many wrong codes. Wait a few minutes and try again.'); end if;
  me := ff.auth(p_code);
  if me is null then return ff.err('Your code wasn''t recognised. Sign in again.'); end if;
  delete from ff.follows where viewer_id = me and owner_id = p_owner_id;
  return jsonb_build_object('account', ff.account_json(me));
end $$;

-- Let someone who asked see your frees.
create or replace function public.ff_approve_viewer(p_code text, p_viewer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  if ff.code_limited() then return ff.err('Too many wrong codes. Wait a few minutes and try again.'); end if;
  me := ff.auth(p_code);
  if me is null then return ff.err('Your code wasn''t recognised. Sign in again.'); end if;
  update ff.follows set status = 'approved' where owner_id = me and viewer_id = p_viewer_id;
  return jsonb_build_object('account', ff.account_json(me));
end $$;

-- Decline a request, or take back someone's access to your frees.
create or replace function public.ff_remove_viewer(p_code text, p_viewer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  if ff.code_limited() then return ff.err('Too many wrong codes. Wait a few minutes and try again.'); end if;
  me := ff.auth(p_code);
  if me is null then return ff.err('Your code wasn''t recognised. Sign in again.'); end if;
  delete from ff.follows where owner_id = me and viewer_id = p_viewer_id;
  return jsonb_build_object('account', ff.account_json(me));
end $$;

-- ----------------------------------------------------------------- admin ---
-- Run these in the Supabase SQL Editor. They live in ff, so the site can't call them.
--   select * from ff.admin_list_accounts();
--   select ff.admin_delete_account('<id from the list>');
--   select ff.admin_delete_account_by_code('apple.river.stone');

create or replace function ff.admin_list_accounts()
returns table (id uuid, name text, created_at timestamptz, free_slots int, following int, viewers int)
language sql stable set search_path = '' as $$
  select a.id, a.name, a.created_at, cardinality(a.free),
         (select count(*)::int from ff.follows f where f.viewer_id = a.id),
         (select count(*)::int from ff.follows f where f.owner_id = a.id)
  from ff.accounts a order by a.created_at
$$;

create or replace function ff.admin_delete_account(p_id uuid) returns text
language sql volatile set search_path = '' as $$
  with d as (delete from ff.accounts where id = p_id returning name)
  select coalesce((select 'Deleted ' || name from d), 'No account with that id')
$$;

create or replace function ff.admin_delete_account_by_code(p_code text) returns text
language sql volatile set search_path = '' as $$
  select ff.admin_delete_account(ff.lookup(p_code))
$$;

-- ----------------------------------------------------------- permissions ---
-- Nothing in ff is reachable by the site's roles; only the public.ff_* API is.

revoke all on schema ff from public, anon, authenticated;
revoke all on all tables in schema ff from public, anon, authenticated;
revoke all on all functions in schema ff from public, anon, authenticated;

revoke all on function
  public.ff_login(text),
  public.ff_create_account(text, text[]),
  public.ff_get_account(text),
  public.ff_update_account(text, text, text[]),
  public.ff_delete_account(text),
  public.ff_request_follow(text, text),
  public.ff_unfollow(text, uuid),
  public.ff_approve_viewer(text, uuid),
  public.ff_remove_viewer(text, uuid)
from public;

grant execute on function
  public.ff_login(text),
  public.ff_create_account(text, text[]),
  public.ff_get_account(text),
  public.ff_update_account(text, text, text[]),
  public.ff_delete_account(text),
  public.ff_request_follow(text, text),
  public.ff_unfollow(text, uuid),
  public.ff_approve_viewer(text, uuid),
  public.ff_remove_viewer(text, uuid)
to anon, authenticated;
