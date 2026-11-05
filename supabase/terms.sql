-- Consumer Talent Exchange: custom terms requests
-- A company proposes different terms -> Consumer Talent accepts, counters or declines in the app ->
-- the company accepts/declines a counter -> once agreed, the company signs the agreed terms (companies.terms).

create table if not exists public.terms_deals(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  proposed jsonb not null,            -- {t1,t2,t3,repl,pay,notes}
  counter jsonb, final jsonb,
  status text not null default 'pending' check (status in ('pending','countered','agreed','declined','withdrawn')),
  note text default '',               -- Consumer Talent's message with a counter or decline
  proposed_by uuid references auth.users(id) on delete set null,
  decided_by text default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.terms_deals enable row level security;
drop policy if exists td_read on public.terms_deals;
create policy td_read on public.terms_deals for select to authenticated using (public.member_of(company_id) or public.is_admin());
do $$ begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='terms_deals') then
  alter publication supabase_realtime add table public.terms_deals; end if; end $$;

create or replace function private.tiers_txt(t jsonb) returns text language sql immutable as $$
  select (t->>'t1')||'/'||(t->>'t2')||'/'||(t->>'t3')||'% fees, '||(t->>'repl')||'-week replacement, '||(t->>'pay')||'-day payment' $$;
create or replace function private.clean_tiers(t jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('t1',least(greatest(coalesce((t->>'t1')::numeric,0),0),60),'t2',least(greatest(coalesce((t->>'t2')::numeric,0),0),60),
    't3',least(greatest(coalesce((t->>'t3')::numeric,0),0),60),'repl',least(greatest(coalesce((t->>'repl')::numeric,0),0),52),
    'pay',least(greatest(coalesce((t->>'pay')::numeric,0),0),120),'notes',left(coalesce(t->>'notes',''),2000)) $$;

-- company: propose (replaces any open proposal)
create or replace function public.terms_propose(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=public.my_company(); d uuid; co text; who text;
begin
  if c is null then raise exception 'Only a company can propose terms'; end if;
  if (select terms from public.companies where id=c) is not null then raise exception 'Your company has already signed terms. Contact Consumer Talent to change them'; end if;
  update public.terms_deals set status='withdrawn',updated_at=now() where company_id=c and status in ('pending','countered');
  insert into public.terms_deals(company_id,proposed,proposed_by) values(c,private.clean_tiers(p),auth.uid()) returning id into d;
  select name into co from public.companies where id=c; select coalesce(nullif(name,''),email) into who from public.profiles where user_id=auth.uid();
  -- email to Jamie and Connor with reply-to the proposer (via the support messages trigger)
  insert into public.support_msgs(user_id,name,email,company,topic,body,payload) values(auth.uid(),who,(select email from auth.users where id=auth.uid()),co,'Terms proposal',
    'Proposed terms for '||co||': '||private.tiers_txt(private.clean_tiers(p))||'. Standard terms are 25/30/35% fees, 8-week replacement, 7-day payment.'
    ||case when coalesce(p->>'notes','')<>'' then E'\n\nNotes: '||(p->>'notes') else '' end||E'\n\nAccept, counter or decline it in the Exchange under Terms requests.',private.clean_tiers(p));
  return d;
end $$;

-- Consumer Talent: accept / counter / decline
create or replace function public.terms_decide(p_deal uuid, p_action text, p_counter jsonb, p_note text) returns void language plpgsql security definer set search_path='' as $$
declare d public.terms_deals; me text;
begin
  if not public.is_admin() then raise exception 'Only Consumer Talent can decide terms'; end if;
  select * into d from public.terms_deals where id=p_deal;
  if d.id is null or d.status<>'pending' then raise exception 'This proposal has already been answered'; end if;
  me:=case when (auth.jwt()->>'email') like 'connor%' then 'Connor' else 'Jamie' end;
  if p_action='accept' then
    update public.terms_deals set status='agreed',final=d.proposed,note=coalesce(p_note,''),decided_by=me,updated_at=now() where id=d.id;
    insert into public.notifications(audience,company_id,text,go) values('company',d.company_id,'Consumer Talent accepted your proposed terms ('||private.tiers_txt(d.proposed)||'). Sign them on the Terms page to put them in place.','terms');
  elsif p_action='counter' then
    update public.terms_deals set status='countered',counter=private.clean_tiers(p_counter),note=coalesce(p_note,''),decided_by=me,updated_at=now() where id=d.id;
    insert into public.notifications(audience,company_id,text,go) values('company',d.company_id,'Consumer Talent sent a counter-offer on your terms ('||private.tiers_txt(private.clean_tiers(p_counter))||'). Review it on the Terms page.','terms');
  elsif p_action='decline' then
    update public.terms_deals set status='declined',note=coalesce(p_note,''),decided_by=me,updated_at=now() where id=d.id;
    insert into public.notifications(audience,company_id,text,go) values('company',d.company_id,'Consumer Talent couldn''t agree your proposed terms.'||case when coalesce(p_note,'')<>'' then ' '||p_note else '' end||' You can sign the standard terms or send a new proposal.','terms');
  else raise exception 'Unknown action'; end if;
  insert into public.events(company_id,what,who) values(d.company_id,'Terms proposal '||case p_action when 'accept' then 'accepted' when 'counter' then 'countered' else 'declined' end,me);
end $$;

-- company: answer a counter-offer
create or replace function public.terms_respond(p_deal uuid, p_accept boolean) returns void language plpgsql security definer set search_path='' as $$
declare d public.terms_deals; co text;
begin
  select * into d from public.terms_deals where id=p_deal;
  if d.id is null or not public.member_of(d.company_id) then raise exception 'Not your company''s terms'; end if;
  if d.status<>'countered' then raise exception 'There''s no counter-offer to answer'; end if;
  select name into co from public.companies where id=d.company_id;
  if p_accept then
    update public.terms_deals set status='agreed',final=d.counter,updated_at=now() where id=d.id;
    insert into public.notifications(audience,text,go) values('admin',co||' accepted your counter-offer ('||private.tiers_txt(d.counter)||'). They''ll sign next.','termsadmin');
  else
    update public.terms_deals set status='declined',updated_at=now() where id=d.id;
    insert into public.notifications(audience,text,go) values('admin',co||' declined your counter-offer on terms.','termsadmin');
  end if;
end $$;

-- when a company signs, its signed tiers must match what was agreed (or the standard terms)
create or replace function public.terms_sign_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare f jsonb;
begin
  if new.terms is null or old.terms is not distinct from new.terms or public.is_admin() or auth.uid() is null then return new; end if;
  -- signed terms can't be rewritten by the company; only the signed copy reference can be added afterwards
  if old.terms is not null then new.terms:=old.terms||jsonb_build_object('agreement',coalesce(new.terms->'agreement',old.terms->'agreement')); return new; end if;
  select final into f from public.terms_deals where company_id=new.id and status='agreed' order by updated_at desc limit 1;
  if coalesce((new.terms->>'custom')::boolean,false) then
    if f is null then raise exception 'There are no agreed custom terms to sign'; end if;
    new.terms:=new.terms||jsonb_build_object('tiers',f);
  else
    new.terms:=new.terms||jsonb_build_object('tiers',jsonb_build_object('t1',25,'t2',30,'t3',35,'repl',8,'pay',7));
  end if;
  insert into public.notifications(audience,text,go) values('admin',new.name||' signed '||case when coalesce((new.terms->>'custom')::boolean,false) then 'their agreed custom terms ('||private.tiers_txt(f)||')' else 'the standard terms' end||'.','clients');
  return new;
end $$;
drop trigger if exists terms_sign_guard on public.companies;
create trigger terms_sign_guard before update of terms on public.companies for each row execute function public.terms_sign_guard();

revoke execute on function public.terms_propose(jsonb), public.terms_decide(uuid,text,jsonb,text), public.terms_respond(uuid,boolean) from public, anon;
grant execute on function public.terms_propose(jsonb), public.terms_decide(uuid,text,jsonb,text), public.terms_respond(uuid,boolean) to authenticated;

-- bring across the proposal sent before this existed
insert into public.terms_deals(company_id,proposed,proposed_by,created_at)
select c.id, s.payload, s.user_id, s.created_at from public.support_msgs s join public.companies c on c.name=s.company
where s.topic='Terms proposal' and s.payload is not null and c.terms is null
  and not exists(select 1 from public.terms_deals t where t.company_id=c.id)
  and s.id=(select max(id) from public.support_msgs s2 where s2.company=s.company and s2.topic='Terms proposal');
