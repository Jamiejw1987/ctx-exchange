-- Link Consumer Talent's alerts to the introduction (deal) they're about, so "Open" goes straight to it.
alter table public.notifications add column if not exists intro_id uuid references public.intros(id) on delete set null;

create or replace function public.note_link_intro() returns trigger language plpgsql security definer set search_path='' as $$
declare r text; co uuid; pro uuid;
begin
  if new.audience<>'admin' or new.intro_id is not null then return new; end if;
  -- 1. an introduction reference in the text, e.g. (CTE-00009)
  r:=substring(new.text from 'CTE-[0-9]+');
  if r is not null then select id into new.intro_id from public.intros where ref=r; if new.intro_id is not null then return new; end if; end if;
  -- 2. otherwise the company and the professional named in the text (longest company name wins)
  select c.id into co from public.companies c where position(c.name in new.text)>0 order by length(c.name) desc limit 1;
  if co is null then return new; end if;
  select p.user_id into pro from public.pro_public p where position('Ref '||p.ref in new.text)>0 limit 1;
  if pro is null then select pp.user_id into pro from public.pro_private pp where coalesce(pp.name,'')<>'' and position(pp.name in new.text)>0 order by length(pp.name) desc limit 1; end if;
  if pro is null then return new; end if;
  select id into new.intro_id from public.intros where company_id=co and pro_id=pro order by created_at desc limit 1;
  return new;
end $$;
drop trigger if exists note_link_intro on public.notifications;
create trigger note_link_intro before insert on public.notifications for each row execute function public.note_link_intro();

-- link the alerts already sent
update public.notifications n set intro_id=i.id from public.intros i where n.audience='admin' and n.intro_id is null and n.text like '%'||i.ref||'%';
update public.notifications n set intro_id=x.iid from (
  select n2.id nid, (select i.id from public.intros i join public.companies c on c.id=i.company_id
      left join public.pro_public pp on pp.user_id=i.pro_id left join public.pro_private pv on pv.user_id=i.pro_id
    where position(c.name in n2.text)>0 and (position('Ref '||pp.ref in n2.text)>0 or (coalesce(pv.name,'')<>'' and position(pv.name in n2.text)>0))
    order by i.created_at desc limit 1) iid
  from public.notifications n2 where n2.audience='admin' and n2.intro_id is null) x
where n.id=x.nid and x.iid is not null;
