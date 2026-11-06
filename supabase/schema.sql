-- Consumer Talent Exchange: live database (stage 1: core loop)
-- Run once in the Supabase SQL editor. Safe to re-run: it drops and recreates the CTX tables (not the waitlist).

-- ---------- helpers ----------
create or replace function public.is_admin() returns boolean language sql stable as $$
  select coalesce(auth.jwt()->>'email','') in ('jamie@consumer-talent.com','connor@consumer-talent.com')
$$;

drop table if exists public.events, public.picks, public.applies, public.notifications, public.messages, public.intros,
  public.pro_private, public.pro_public, public.company_members, public.companies, public.profiles cascade;
drop sequence if exists public.pro_ref_seq, public.intro_ref_seq;
create sequence public.pro_ref_seq start 1001;
create sequence public.intro_ref_seq start 1;

-- ---------- accounts ----------
create table public.profiles(
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('client','pro','admin')),
  name text, email text, title text,
  created_at timestamptz not null default now());

create table public.companies(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending' check (status in ('pending','approved','declined','suspended','requested','denied')),
  data jsonb not null default '{}'::jsonb,      -- public profile: stage, hq, cats, roles, tagline, about, why, logo, anon, sector...
  private jsonb not null default '{}'::jsonb,   -- contact name/title/email/phone, alerts. Never shown to professionals.
  terms jsonb,                                  -- signed terms: {name,title,email,at,ref,tiers}
  access jsonb not null default '{}'::jsonb,    -- {why,note,at,by,req:{at,by,note},hist:[]}  (admin + own members)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now());

create table public.company_members(
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'Admin',
  primary key(company_id,user_id));

create or replace function public.my_company() returns uuid language sql stable security definer set search_path=public as $$
  select company_id from public.company_members where user_id=auth.uid() limit 1
$$;
create or replace function public.member_of(c uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.company_members where company_id=c and user_id=auth.uid())
$$;
create or replace function public.approved_member() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id where m.user_id=auth.uid() and c.status='approved')
$$;
create or replace function public.terms_signed(c uuid) returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select terms is not null from public.companies where id=c),false)
$$;

-- ---------- professionals: anonymous part and private part kept apart ----------
create table public.pro_public(
  user_id uuid primary key references auth.users(id) on delete cascade,
  ref text unique not null default ('Ref CTX-'||nextval('public.pro_ref_seq')),
  data jsonb not null default '{}'::jsonb,      -- lvl, region, headline, summary, hl, career (anonymised), retailers, cats, band...
  updated_at timestamptz not null default now());

create table public.pro_private(
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text, email text, phone text,
  current text,                                  -- current employer
  hide text[] not null default '{}',             -- companies they never want to be shown to
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now());

-- a professional is hidden from a company if it's their employer or on their hide list
create or replace function public.pro_hidden_from(p uuid, c uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.pro_private pp, public.companies co
    where pp.user_id=p and co.id=c and (
      (pp.current is not null and length(trim(pp.current))>2 and (lower(co.name) like '%'||lower(trim(pp.current))||'%' or lower(trim(pp.current)) like '%'||lower(co.name)||'%'))
      or exists(select 1 from unnest(pp.hide) h where length(trim(h))>2 and (lower(co.name) like '%'||lower(trim(h))||'%' or lower(trim(h)) like '%'||lower(co.name)||'%'))))
$$;

-- ---------- introductions and chat ----------
create table public.intros(
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('CTE-'||lpad(nextval('public.intro_ref_seq')::text,5,'0')),
  company_id uuid not null references public.companies(id) on delete cascade,
  pro_id uuid not null references auth.users(id) on delete cascade,
  role text default '', base text default '', note text default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent','accepted','declined','closed','blocked')),
  prior jsonb,                 -- the professional's answer: interviewed with them in the last 6 months?
  accepted_at timestamptz, declined_at timestamptz,
  closed jsonb,                -- {by:'client'|'pro', at}
  from_apply boolean not null default false,
  client_state jsonb not null default '{}'::jsonb,   -- client-side extras (prior decision, feedback, interview notes...)
  pro_state jsonb not null default '{}'::jsonb);
create unique index intros_one_open on public.intros(company_id,pro_id) where status in ('sent','accepted');

create table public.messages(
  id bigint generated always as identity primary key,
  intro_id uuid not null references public.intros(id) on delete cascade,
  author uuid references auth.users(id),
  side text not null check (side in ('client','pro','ct','sys')),
  audience text not null default 'both' check (audience in ('both','client','pro')),
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());

create table public.notifications(
  id bigint generated always as identity primary key,
  audience text not null check (audience in ('admin','user','company')),
  user_id uuid, company_id uuid,
  text text not null, go text default '',
  read boolean not null default false,
  created_at timestamptz not null default now());

create table public.applies(
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null default '',               -- '' = interested in working there generally
  note text default '',
  status text not null default 'new' check (status in ('new','revealed','declined','withdrawn')),
  created_at timestamptz not null default now(),
  unique(pro_id,company_id,role));

create table public.picks(
  company_id uuid references public.companies(id) on delete cascade,
  pro_id uuid references auth.users(id) on delete cascade,
  decision text not null check (decision in ('keep','pass')),
  at timestamptz not null default now(),
  primary key(company_id,pro_id));

-- protection log: insert-only, nobody can edit or delete it from the app
create table public.events(
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete cascade,
  pro_id uuid references auth.users(id) on delete set null,
  intro_id uuid references public.intros(id) on delete set null,
  what text not null, who text default '',
  at timestamptz not null default now());

-- ---------- views ----------
-- what professionals can see of a company (anonymous companies keep their name hidden)
create or replace view public.companies_public as
  select id, case when coalesce((data->>'anon')::boolean,false) then null else name end as name,
         case when coalesce((data->>'anon')::boolean,false) then data - 'name' - 'logo' - 'hq' - 'site' - 'contact' - 'contactTitle' - 'email' - 'phone'
              else data - 'contact' - 'contactTitle' - 'email' - 'phone' end as data,
         (terms is not null) as signed, created_at
  from public.companies where status='approved';
grant select on public.companies_public to authenticated;

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.pro_public enable row level security;
alter table public.pro_private enable row level security;
alter table public.intros enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.applies enable row level security;
alter table public.picks enable row level security;
alter table public.events enable row level security;

create policy p_self on public.profiles for select using (user_id=auth.uid() or public.is_admin());
create policy p_upd on public.profiles for update using (user_id=auth.uid());

create policy co_read on public.companies for select using (public.member_of(id) or public.is_admin());
create policy co_upd on public.companies for update using (public.member_of(id) or public.is_admin());

create policy cm_read on public.company_members for select using (user_id=auth.uid() or public.member_of(company_id) or public.is_admin());

-- companies see anonymous profiles once approved (never people who've hidden from them);
-- they can also see anyone who applied to them or that they've been introduced to
create policy pp_read on public.pro_public for select using (
  user_id=auth.uid() or public.is_admin()
  or (public.approved_member() and not public.pro_hidden_from(user_id, public.my_company()))
  or exists(select 1 from public.intros i where i.pro_id=pro_public.user_id and public.member_of(i.company_id))
  or exists(select 1 from public.applies a where a.pro_id=pro_public.user_id and public.member_of(a.company_id)));
create policy pp_upd on public.pro_public for update using (user_id=auth.uid());

-- names and contact details only after the professional accepted AND the company has signed terms
create policy pv_read on public.pro_private for select using (
  user_id=auth.uid() or public.is_admin()
  or exists(select 1 from public.intros i where i.pro_id=pro_private.user_id and i.accepted_at is not null
            and public.member_of(i.company_id) and public.terms_signed(i.company_id)
            and not coalesce((i.prior->>'prior')='Yes' and coalesce(i.client_state->>'priorDecision','')<>'continue',false)));
create policy pv_upd on public.pro_private for update using (user_id=auth.uid());

create policy in_read on public.intros for select using (pro_id=auth.uid() or public.member_of(company_id) or public.is_admin());
create policy in_ins on public.intros for insert with check (public.member_of(company_id) and created_by=auth.uid());
create policy in_upd on public.intros for update using (pro_id=auth.uid() or public.member_of(company_id) or public.is_admin());

create or replace function public.party_side(i uuid) returns text language sql stable security definer set search_path=public as $$
  select case when exists(select 1 from public.intros where id=i and pro_id=auth.uid()) then 'pro'
              when exists(select 1 from public.intros x where x.id=i and public.member_of(x.company_id)) then 'client'
              when public.is_admin() then 'admin' end
$$;
create policy ms_read on public.messages for select using (
  public.is_admin() or (public.party_side(intro_id) in ('client','pro') and audience in ('both', public.party_side(intro_id))));
create policy ms_ins on public.messages for insert with check (
  author=auth.uid() and (
    (side=public.party_side(intro_id) and audience='both')
    or (side in ('sys','ct') and audience=public.party_side(intro_id))
    or public.is_admin()));

create policy nt_read on public.notifications for select using (
  (audience='user' and user_id=auth.uid()) or (audience='company' and public.member_of(company_id)) or (audience='admin' and public.is_admin()));
create policy nt_ins on public.notifications for insert with check (audience='admin' and auth.uid() is not null);
create policy nt_upd on public.notifications for update using (
  (audience='user' and user_id=auth.uid()) or (audience='company' and public.member_of(company_id)) or (audience='admin' and public.is_admin()));

create policy ap_read on public.applies for select using (pro_id=auth.uid() or public.member_of(company_id) or public.is_admin());
create policy ap_ins on public.applies for insert with check (pro_id=auth.uid());
create policy ap_upd on public.applies for update using (pro_id=auth.uid() or public.member_of(company_id));
create policy ap_del on public.applies for delete using (pro_id=auth.uid());

create policy pk_all on public.picks for all using (public.member_of(company_id)) with check (public.member_of(company_id));

create policy ev_read on public.events for select using (public.is_admin() or public.member_of(company_id));
create policy ev_ins on public.events for insert with check (
  auth.uid() is not null and (public.member_of(company_id) or pro_id=auth.uid() or public.is_admin()));

-- ---------- guard rails (triggers) ----------
-- only the professional can accept or decline; nobody can un-accept
create or replace function public.intro_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    if new.accepted_at is not null and not exists(select 1 from public.applies a where a.pro_id=new.pro_id and a.company_id=new.company_id) then
      raise exception 'Only the professional can accept an introduction';
    end if;
    if new.accepted_at is not null then new.status:='accepted'; end if;
    if public.pro_hidden_from(new.pro_id,new.company_id) then new.status:='blocked'; end if;
    return new;
  end if;
  if (new.accepted_at is distinct from old.accepted_at or new.declined_at is distinct from old.declined_at or new.prior is distinct from old.prior)
     and auth.uid() is not null and auth.uid() is distinct from new.pro_id and not public.is_admin() then
    raise exception 'Only the professional can accept or decline';
  end if;
  if old.accepted_at is not null and new.accepted_at is null then raise exception 'An accepted introduction cannot be undone'; end if;
  new.company_id:=old.company_id; new.pro_id:=old.pro_id; new.ref:=old.ref; new.created_at:=old.created_at;
  return new;
end $$;
create trigger intro_guard before insert or update on public.intros for each row execute function public.intro_guard();

-- block contact details in chat on the server too
create or replace function public.msg_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare co uuid; nm text;
begin
  if new.side in ('client','pro') and new.body ~* '([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,})|(\+?[0-9][0-9 ().-]{8,}[0-9])|(linkedin\.com)|(https?://)|(www\.)' then
    select company_id into co from public.intros where id=new.intro_id;
    select name into nm from public.companies where id=co;
    insert into public.notifications(audience,text,go) values('admin', coalesce(nm,'A company')||' chat: a '||case when new.side='pro' then 'professional' else 'company' end||' tried to share contact details. The message was blocked.','dash');
    new.payload := new.payload || jsonb_build_object('blocked',true);
    new.audience := new.side; new.side := 'sys';
    new.body := 'Message not sent. Contact details and links are blocked in chat. Use Schedule interview and the details are shared automatically.';
  end if;
  return new;
end $$;
create trigger msg_guard before insert on public.messages for each row execute function public.msg_guard();

-- ---------- notifications the server sends ----------
create or replace function public.co_label(c uuid) returns text language sql stable security definer set search_path=public as $$
  select case when coalesce((data->>'anon')::boolean,false) then 'A company' else name end from public.companies where id=c
$$;

create or replace function public.intro_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare pref text;
begin
  select ref into pref from public.pro_public where user_id=new.pro_id;
  if tg_op='INSERT' then
    if new.status='blocked' then
      insert into public.notifications(audience,company_id,text,go) values('company',new.company_id, coalesce(pref,'This professional')||' isn''t available for introductions to your company','shortlist');
      insert into public.notifications(audience,text,go) values('admin','Blocked automatically: '||public.co_label(new.company_id)||' asked to meet '||coalesce(pref,'a professional')||', who works there or has hidden from them','dash');
    elsif new.from_apply then
      insert into public.notifications(audience,user_id,text,go) values('user',new.pro_id, public.co_label(new.company_id)||' would like to talk to you about '||case when coalesce(new.role,'')<>'' then 'the '||new.role||' role' else 'working there' end,'messages');
      insert into public.notifications(audience,text,go) values('admin','Introduction made: '||public.co_label(new.company_id)||' opened a chat with '||coalesce(pref,'a professional')||' who applied ('||new.ref||')','protect');
    else
      insert into public.notifications(audience,user_id,text,go) values('user',new.pro_id, public.co_label(new.company_id)||' would like '||case when coalesce(new.role,'')<>'' then 'to speak with you about '||new.role else 'to have a chat with you' end,'introductions');
    end if;
    insert into public.events(company_id,pro_id,intro_id,what,who) values(new.company_id,new.pro_id,new.id,
      case when new.from_apply then 'Introduction made from their application, chat opened' else 'Requested introduction to '||coalesce(pref,'')||case when coalesce(new.role,'')<>'' then ' for '||new.role else '' end end,'Company');
  elsif new.accepted_at is not null and old.accepted_at is null then
    insert into public.notifications(audience,company_id,text,go) values('company',new.company_id, coalesce(pref,'They')||' accepted your request to chat'||case when (new.prior->>'prior')='Yes' then ', but interviewed with you in the last six months. Decide whether to continue.' else '. Your conversation is open.' end,'chats');
    insert into public.notifications(audience,text,go) values('admin','Introduction made: '||coalesce(pref,'a professional')||' accepted '||public.co_label(new.company_id)||'''s request to chat ('||new.ref||')'||case when (new.prior->>'prior')='Yes' then '. They interviewed there in the last six months.' else '' end,'protect');
    insert into public.events(company_id,pro_id,intro_id,what,who) values(new.company_id,new.pro_id,new.id,'Introduction accepted, chat opened ('||new.ref||')','Professional');
    insert into public.messages(intro_id,side,audience,body,payload) values(new.id,'sys','client','Introduction made. Protected introduction '||new.ref||' runs until '||to_char(now()+interval '12 months','FMDD FMMonth YYYY')||', 12 months from your latest interaction. If you hire them in that time, our fee applies, including if either of you gets in touch directly.','{"f":"sys"}');
  elsif new.declined_at is not null and old.declined_at is null then
    insert into public.notifications(audience,company_id,text,go) values('company',new.company_id, coalesce(pref,'They')||' didn''t want to move forward at this time','shortlist');
    insert into public.events(company_id,pro_id,intro_id,what,who) values(new.company_id,new.pro_id,new.id,'Declined the request to chat','Professional');
  elsif new.closed is not null and old.closed is null then
    if new.closed->>'by'='pro' then
      insert into public.notifications(audience,company_id,text,go) values('company',new.company_id, coalesce(pref,'They')||' decided not to take this forward','chats');
    else
      insert into public.notifications(audience,user_id,text,go) values('user',new.pro_id, public.co_label(new.company_id)||' decided not to take this forward','messages');
    end if;
    insert into public.events(company_id,pro_id,intro_id,what,who) values(new.company_id,new.pro_id,new.id,'Conversation closed by the '||case when new.closed->>'by'='pro' then 'professional' else 'company' end,'Exchange');
  end if;
  return new;
end $$;
create trigger intro_notify after insert or update on public.intros for each row execute function public.intro_notify();

create or replace function public.msg_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare i public.intros; pref text;
begin
  if new.audience<>'both' then return new; end if;
  select * into i from public.intros where id=new.intro_id;
  select ref into pref from public.pro_public where user_id=i.pro_id;
  if new.side='client' then
    insert into public.notifications(audience,user_id,text,go) values('user',i.pro_id,'New message from '||public.co_label(i.company_id),'messages');
  elsif new.side='pro' then
    insert into public.notifications(audience,company_id,text,go) values('company',i.company_id,'New message from '||coalesce(pref,'a professional'),'chats');
  end if;
  insert into public.events(company_id,pro_id,intro_id,what,who) values(i.company_id,i.pro_id,i.id,'Message in chat','' || new.side);
  return new;
end $$;
create trigger msg_notify after insert on public.messages for each row execute function public.msg_notify();

create or replace function public.apply_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare pref text;
begin
  select ref into pref from public.pro_public where user_id=new.pro_id;
  if tg_op='INSERT' then
    insert into public.notifications(audience,company_id,text,go) values('company',new.company_id, coalesce(pref,'A professional')||case when new.role<>'' then ' is interested in your '||new.role||' role' else ' is interested in working for you' end,'applicants');
    insert into public.notifications(audience,text,go) values('admin', coalesce(pref,'A professional')||case when new.role<>'' then ' applied for '||new.role||' at ' else ' is interested in working for ' end||(select name from public.companies where id=new.company_id),'clients');
  elsif new.status='declined' and old.status<>'declined' then
    insert into public.notifications(audience,user_id,text,go) values('user',new.pro_id, public.co_label(new.company_id)||' isn''t taking your '||case when new.role<>'' then new.role||' application' else 'interest' end||' forward right now. Your details were never shared.','allcos');
  end if;
  return new;
end $$;
create trigger apply_notify after insert or update on public.applies for each row execute function public.apply_notify();

-- ---------- sign-up: create the account rows ----------
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare r text := coalesce(new.raw_user_meta_data->>'role','pro'); cid uuid;
begin
  if new.email in ('jamie@consumer-talent.com','connor@consumer-talent.com') then r:='admin'; end if;
  insert into public.profiles(user_id,role,name,email,title) values(new.id,r,new.raw_user_meta_data->>'name',new.email,new.raw_user_meta_data->>'title')
    on conflict (user_id) do nothing;
  if r='client' then
    insert into public.companies(name,private,created_by,data) values(
      coalesce(nullif(trim(new.raw_user_meta_data->>'company'),''),'New company'),
      jsonb_build_object('contact',new.raw_user_meta_data->>'name','contactTitle',new.raw_user_meta_data->>'title','email',new.email,'phone',new.raw_user_meta_data->>'phone'),
      new.id, jsonb_build_object('sector',coalesce(new.raw_user_meta_data->>'sector','Food'),'stage','CHAL','roles','[]'::jsonb,'cats','[]'::jsonb))
      returning id into cid;
    insert into public.company_members(company_id,user_id,role) values(cid,new.id,'Admin');
    insert into public.notifications(audience,text,go) values('admin','New company signed up: '||coalesce(new.raw_user_meta_data->>'company','')||' ('||coalesce(new.raw_user_meta_data->>'name','')||', '||new.email||'). Approve them to let them in.','invites');
  elsif r='pro' then
    insert into public.pro_public(user_id,data) values(new.id, jsonb_build_object('sector',coalesce(new.raw_user_meta_data->>'sector','Food'),'lvl',coalesce(new.raw_user_meta_data->>'lvl',''),'region',coalesce(new.raw_user_meta_data->>'region','')));
    insert into public.pro_private(user_id,name,email,phone) values(new.id,new.raw_user_meta_data->>'name',new.email,new.raw_user_meta_data->>'phone');
    insert into public.notifications(audience,text,go) values('admin','New professional joined: '||coalesce(new.raw_user_meta_data->>'name','')||' ('||new.email||')','dash');
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Jamie and Connor already exist: give them admin profiles
insert into public.profiles(user_id,role,name,email) select id,'admin',initcap(split_part(email,'@',1)),email from auth.users
  where email in ('jamie@consumer-talent.com','connor@consumer-talent.com') on conflict do nothing;

-- ---------- live updates ----------
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.intros; exception when others then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when others then null; end;
  begin alter publication supabase_realtime add table public.applies; exception when others then null; end;
  begin alter publication supabase_realtime add table public.companies; exception when others then null; end;
  begin alter publication supabase_realtime add table public.picks; exception when others then null; end;
end $$;

-- ---------- more guard rails ----------
-- companies can't approve themselves or change their own access; they can only ask for access back
create or replace function public.company_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;
  if new.status is distinct from old.status then
    if old.status in ('suspended','denied') and new.status='requested' then
      new.access := old.access || jsonb_build_object('req', new.access->'req', 'hist', new.access->'hist');
    else
      new.status := old.status; new.access := old.access;
    end if;
  else
    new.access := old.access;
  end if;
  new.created_by := old.created_by; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists company_guard on public.companies;
create trigger company_guard before update on public.companies for each row execute function public.company_guard();

-- a professional's reference number never changes
create or replace function public.pro_guard() returns trigger language plpgsql as $$
begin new.ref := old.ref; new.updated_at := now(); return new; end $$;
drop trigger if exists pro_guard on public.pro_public;
create trigger pro_guard before update on public.pro_public for each row execute function public.pro_guard();

-- Jamie and Connor can send notifications to anyone
drop policy if exists nt_ins on public.notifications;
create policy nt_ins on public.notifications for insert with check ((audience='admin' and auth.uid() is not null) or public.is_admin());
-- and see everyone's account rows
drop policy if exists cm_read on public.company_members;
create policy cm_read on public.company_members for select using (user_id=auth.uid() or public.member_of(company_id) or public.is_admin());
