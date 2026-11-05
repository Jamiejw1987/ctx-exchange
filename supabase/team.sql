-- Consumer Talent Exchange: team members for companies
-- A company admin invites colleagues by email. The colleague signs up from the invite link (or with the
-- invited email) and joins the existing, already-approved company account: no new company, no approval.
-- Roles: Admin (manages team, signs terms) and Hiring manager (browses, shortlists, chats, books interviews).

alter table public.company_members add column if not exists dept text default '';
alter table public.company_members add column if not exists joined_at timestamptz default now();

create table if not exists public.company_invites(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null, name text default '', title text default '', dept text default '',
  role text not null default 'Hiring manager' check (role in ('Admin','Hiring manager')),
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  created_at timestamptz not null default now(), accepted_at timestamptz);
create unique index if not exists company_invites_open on public.company_invites(lower(email)) where status='pending';
alter table public.company_invites enable row level security;
drop policy if exists ci_read on public.company_invites;
create policy ci_read on public.company_invites for select to authenticated using (public.member_of(company_id) or public.is_admin());

create or replace function private.is_co_admin(c uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.company_members where company_id=c and user_id=auth.uid() and role='Admin') $$;

-- invite email
create or replace function private.send_invite(p_inv uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.company_invites; co text; who text;
begin
  select * into v from public.company_invites where id=p_inv;
  select name into co from public.companies where id=v.company_id;
  select coalesce(nullif(name,''),email) into who from public.profiles where user_id=v.invited_by;
  perform private.send_email(v.email,
    coalesce(who,'A colleague')||' invited you to '||co||' on the Consumer Talent Exchange',
    'Join '||co||' on the Consumer Talent Exchange',
    coalesce(who,'A colleague')||' has added you to '||co||'''s account. You''ll be able to browse anonymous food and drink professionals, shortlist them and chat about your roles. Create your password to get started.',
    'Accept invite', private.setting('app_url')||'?invite='||v.id, 'invite');
end $$;

create or replace function public.team_invite(p_email text, p_name text, p_title text, p_dept text, p_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=public.my_company(); em text:=lower(trim(p_email)); new_id uuid;
begin
  if c is null or not private.is_co_admin(c) then raise exception 'Only an admin on your company account can invite colleagues'; end if;
  if (select co.status from public.companies co where co.id=c)<>'approved' then raise exception 'Your company needs to be approved before you can invite colleagues'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Add a valid work email'; end if;
  if exists(select 1 from auth.users where lower(email)=em) then raise exception 'That email already has an account on the Exchange. Contact Consumer Talent and we''ll sort it out'; end if;
  if exists(select 1 from public.company_invites where lower(email)=em and status='pending') then raise exception 'They''ve already been invited. Use Resend if they can''t find the email'; end if;
  insert into public.company_invites(company_id,email,name,title,dept,role,invited_by)
    values(c,em,coalesce(trim(p_name),''),coalesce(trim(p_title),''),coalesce(p_dept,''),case when p_role='Admin' then 'Admin' else 'Hiring manager' end,auth.uid()) returning company_invites.id into new_id;
  perform private.send_invite(new_id);
  return new_id;
end $$;

create or replace function public.team_invite_action(p_inv uuid, p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare v public.company_invites;
begin
  select * into v from public.company_invites where id=p_inv;
  if v.id is null or not private.is_co_admin(v.company_id) then raise exception 'Only an admin can change invites'; end if;
  if v.status<>'pending' then raise exception 'That invite has already been used or cancelled'; end if;
  if p_action='resend' then perform private.send_invite(v.id);
  elsif p_action='cancel' then update public.company_invites set status='cancelled' where id=v.id;
  else raise exception 'Unknown action'; end if;
end $$;

create or replace function public.team_member_action(p_user uuid, p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=public.my_company(); m public.company_members; admins int;
begin
  if c is null or not private.is_co_admin(c) then raise exception 'Only an admin can manage the team'; end if;
  select * into m from public.company_members where company_id=c and user_id=p_user;
  if m.user_id is null then raise exception 'They''re not on your team'; end if;
  select count(*) into admins from public.company_members where company_id=c and role='Admin';
  if p_action='make_admin' then update public.company_members set role='Admin' where company_id=c and user_id=p_user;
  elsif p_action='remove_admin' then
    if m.role='Admin' and admins<=1 then raise exception 'Your account needs at least one admin'; end if;
    update public.company_members set role='Hiring manager' where company_id=c and user_id=p_user;
  elsif p_action='remove' then
    if p_user=auth.uid() then raise exception 'You can''t remove yourself. Ask another admin'; end if;
    if m.role='Admin' and admins<=1 then raise exception 'Your account needs at least one admin'; end if;
    insert into public.events(company_id,what,who) values(c,'Removed '||coalesce((select coalesce(nullif(name,''),email) from public.profiles where user_id=p_user),'a colleague')||' from the company account',
      coalesce((select name from public.profiles where user_id=auth.uid()),''));
    delete from auth.users where id=p_user;   -- their sign-in goes; the company's chats and records stay
  else raise exception 'Unknown action'; end if;
end $$;

-- the team screen: everyone on my company's account, plus open invites
create or replace function public.team_list() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(p.name,''),u.email),'email',u.email,'title',coalesce(p.title,''),
        'dept',coalesce(m.dept,''),'role',m.role,'joined',coalesce(m.joined_at,u.created_at),'me',m.user_id=auth.uid()) order by m.joined_at)
      from public.company_members m join auth.users u on u.id=m.user_id left join public.profiles p on p.user_id=m.user_id where m.company_id=public.my_company()),'[]'::jsonb),
    'invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'email',i.email,'title',i.title,'dept',i.dept,'role',i.role,'at',i.created_at) order by i.created_at)
      from public.company_invites i where i.company_id=public.my_company() and i.status='pending'),'[]'::jsonb),
    'admin',private.is_co_admin(public.my_company())) $$;

-- what the invite link shows before sign-up (the id is an unguessable token)
create or replace function public.invite_info(p_inv uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('company',c.name,'email',i.email,'name',i.name,'title',i.title)
  from public.company_invites i join public.companies c on c.id=i.company_id where i.id=p_inv and i.status='pending' $$;

revoke execute on function public.team_invite(text,text,text,text,text), public.team_invite_action(uuid,text), public.team_member_action(uuid,text), public.team_list() from public, anon;
grant execute on function public.team_invite(text,text,text,text,text), public.team_invite_action(uuid,text), public.team_member_action(uuid,text), public.team_list() to authenticated;
grant execute on function public.invite_info(uuid) to anon, authenticated;

-- sign-up: an invited colleague joins the existing company instead of creating a new one
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare r text := coalesce(new.raw_user_meta_data->>'role','pro'); cid uuid; inv public.company_invites;
begin
  if new.email in ('jamie@consumer-talent.com','connor@consumer-talent.com') then r:='admin'; end if;
  select * into inv from public.company_invites where lower(email)=lower(new.email) and status='pending' order by created_at desc limit 1;
  if inv.id is not null and r<>'admin' then r:='client'; end if;
  insert into public.profiles(user_id,role,name,email,title) values(new.id,r,coalesce(nullif(new.raw_user_meta_data->>'name',''),inv.name),new.email,coalesce(nullif(new.raw_user_meta_data->>'title',''),inv.title))
    on conflict (user_id) do nothing;
  if r='client' and inv.id is not null then
    -- tell the existing team first, so the newcomer doesn't get their own "joined" alert
    insert into public.notifications(audience,company_id,text,go) values('company',inv.company_id,coalesce(nullif(new.raw_user_meta_data->>'name',''),inv.name,new.email)||' joined your team on the Exchange','team');
    insert into public.company_members(company_id,user_id,role,dept) values(inv.company_id,new.id,inv.role,inv.dept);
    update public.company_invites set status='accepted',accepted_at=now() where id=inv.id;
    insert into public.notifications(audience,text,go) values('admin','Team member joined: '||coalesce(nullif(new.raw_user_meta_data->>'name',''),inv.name,new.email)||' joined '||(select name from public.companies where id=inv.company_id)||'''s account','clients');
  elsif r='client' then
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

-- removing a colleague must not be blocked by records they created
alter table public.intros drop constraint if exists intros_created_by_fkey;
alter table public.intros add constraint intros_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

-- ---------- teaser for companies waiting for approval: counts only, never profiles ----------
create or replace function public.pool_teaser() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c uuid:=public.my_company(); d jsonb; lv text[]; rg text[]; res jsonb;
begin
  if c is null then return null; end if;
  select data into d from public.companies where id=c;
  lv:=array(select jsonb_array_elements_text(coalesce(d->'levels','[]'::jsonb)));
  rg:=array(select jsonb_array_elements_text(coalesce(d->'regions','[]'::jsonb)));
  with pool as (
    select p.data->>'lvl' lvl, p.data->>'region' region from public.pro_public p
    where not public.pro_hidden_from(p.user_id,c))
  select jsonb_build_object(
    'total',(select count(*) from pool),
    'match',(select count(*) from pool where (cardinality(lv)=0 or lvl=any(lv)) and (cardinality(rg)=0 or region=any(rg) or 'National'=any(rg))),
    'filtered',cardinality(lv)>0 or cardinality(rg)>0,
    'levels',coalesce((select jsonb_object_agg(lvl,n) from (select lvl,count(*) n from pool where coalesce(lvl,'')<>'' group by lvl) x),'{}'::jsonb),
    'regions',coalesce((select jsonb_object_agg(region,n) from (select region,count(*) n from pool where coalesce(region,'')<>'' group by region) y),'{}'::jsonb))
  into res;
  return res;
end $$;
revoke execute on function public.pool_teaser() from public, anon;
grant execute on function public.pool_teaser() to authenticated;
