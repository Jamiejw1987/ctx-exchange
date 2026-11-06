-- Consumer Talent Exchange: interview booking
-- Flow: company proposes 1-3 times -> professional picks one (or asks for new times) -> booked
--       (calendar invites by email, contact details shared both ways, protection record updated)
--       -> either side can reschedule/cancel -> after the time, company records the outcome
--       (another round / making an offer / not progressing) and both can leave feedback.
-- All changes go through the security-definer functions below; the table itself is read-only to users.
-- Times are stored in UTC. Each person's time zone (profiles.tz) is used to show times and write emails.

alter table public.profiles add column if not exists tz text;

create table if not exists public.interviews(
  id uuid primary key default gen_random_uuid(),
  intro_id uuid not null references public.intros(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  pro_id uuid not null references auth.users(id) on delete cascade,
  round int not null default 1,
  kind text not null check (kind in ('video','phone','in_person')),
  minutes int not null default 45 check (minutes between 15 and 240),
  slots timestamptz[] not null,
  location text default '',
  note text default '',
  status text not null default 'proposed' check (status in ('proposed','new_times','booked','held','cancelled')),
  starts_at timestamptz,
  seq int not null default 0,
  proposed_by uuid references auth.users(id) on delete set null,
  booker_tz text,
  new_times_note text,
  cancelled jsonb,                  -- {by:'client'|'pro', reason, at}
  outcome text check (outcome in ('next','offer','no')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index if not exists interviews_intro on public.interviews(intro_id);
alter table public.interviews drop column if exists client_feedback, drop column if exists pro_feedback;
-- notes after an interview: only Consumer Talent (and the person who wrote them) can read them
create table if not exists public.iv_feedback(
  id bigint generated always as identity primary key,
  iv_id uuid not null references public.interviews(id) on delete cascade,
  side text not null check (side in ('client','pro')),
  author uuid references auth.users(id) on delete set null,
  body text not null, created_at timestamptz not null default now());
alter table public.iv_feedback enable row level security;
drop policy if exists ivf_read on public.iv_feedback;
create policy ivf_read on public.iv_feedback for select to authenticated using (public.is_admin() or author=auth.uid());
alter table public.interviews enable row level security;
drop policy if exists iv_read on public.interviews;
create policy iv_read on public.interviews for select to authenticated
  using (pro_id=auth.uid() or public.member_of(company_id) or public.is_admin());
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='interviews') then
    alter publication supabase_realtime add table public.interviews; end if; end $$;

-- ---------- helpers ----------
create or replace function private.ics_esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t,''),'\','\\'),';','\;'),',','\,'),E'\n','\n') $$;
create or replace function private.ics_ts(t timestamptz) returns text language sql immutable as $$
  select to_char(t at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"') $$;
create or replace function private.tz_name(tz text) returns text language sql immutable as $$
  select case
    when tz in ('America/New_York','America/Detroit','America/Toronto','America/Indiana/Indianapolis','America/Kentucky/Louisville','America/Montreal') then 'Eastern time'
    when tz in ('America/Chicago','America/Winnipeg','America/Indiana/Knox','America/Menominee') then 'Central time'
    when tz in ('America/Denver','America/Edmonton','America/Boise') then 'Mountain time'
    when tz='America/Phoenix' then 'Arizona time'
    when tz in ('America/Los_Angeles','America/Vancouver','America/Tijuana') then 'Pacific time'
    when tz='America/Anchorage' then 'Alaska time' when tz='Pacific/Honolulu' then 'Hawaii time'
    when tz in ('America/Halifax','America/Moncton') then 'Atlantic time' when tz='America/St_Johns' then 'Newfoundland time'
    when tz='America/Mexico_City' then 'Mexico City time' when tz='Europe/London' then 'UK time'
    else replace(split_part(tz,'/',array_length(string_to_array(tz,'/'),1)),'_',' ')||' time' end $$;
create or replace function private.fmt_local(t timestamptz, tz text) returns text language sql stable as $$
  select trim(to_char(t at time zone coalesce(nullif(tz,''),'America/New_York'),'FMDay FMDD FMMonth YYYY, FMHH12:MI AM'))
    ||' '||private.tz_name(coalesce(nullif(tz,''),'America/New_York')) $$;
create or replace function private.iv_kind(k text) returns text language sql immutable as $$
  select case k when 'video' then 'Video interview' when 'phone' then 'Phone interview' else 'In-person interview' end $$;

create or replace function private.iv_ics(p_iv uuid, p_cancel boolean, title text, bname text, btitle text, bemail text, cophone text, pname text, pemail text, pphone text)
returns text language plpgsql stable security definer set search_path='' as $f$
declare v public.interviews; ics text;
begin
  select * into v from public.interviews where id=p_iv;
  ics:='BEGIN:VCALENDAR'||E'\r\n'||'PRODID:-//Consumer Talent//Exchange//EN'||E'\r\n'||'VERSION:2.0'||E'\r\n'||'CALSCALE:GREGORIAN'||E'\r\n'
    ||'METHOD:'||case when p_cancel then 'CANCEL' else 'REQUEST' end||E'\r\n'||'BEGIN:VEVENT'||E'\r\n'
    ||'UID:'||v.id||'@consumer-talent.com'||E'\r\n'||'SEQUENCE:'||v.seq||E'\r\n'||'DTSTAMP:'||private.ics_ts(now())||E'\r\n'
    ||'DTSTART:'||private.ics_ts(v.starts_at)||E'\r\n'||'DTEND:'||private.ics_ts(v.starts_at+make_interval(mins=>v.minutes))||E'\r\n'
    ||'SUMMARY:'||private.ics_esc(title)||E'\r\n'
    ||'LOCATION:'||private.ics_esc(case when v.kind='phone' then coalesce(nullif(v.location,''),'Phone call') else v.location end)||E'\r\n'
    ||'DESCRIPTION:'||private.ics_esc('Arranged through the Consumer Talent Exchange. '||coalesce(v.note,'')||E'\n\nCompany contact: '||bname||coalesce(' ('||nullif(btitle,'')||')','')||', '||coalesce(bemail,'')||coalesce(', '||nullif(cophone,''),'')||E'\nCandidate: '||pname||', '||coalesce(pemail,'')||coalesce(', '||nullif(pphone,''),''))||E'\r\n'
    ||'ORGANIZER;CN=Consumer Talent Exchange:mailto:noreply@consumer-talent.com'||E'\r\n'
    ||'ATTENDEE;CN='||private.ics_esc(pname)||';ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:'||coalesce(pemail,'')||E'\r\n'
    ||'ATTENDEE;CN='||private.ics_esc(bname)||';ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:'||coalesce(bemail,'')||E'\r\n'
    ||'STATUS:'||case when p_cancel then 'CANCELLED' else 'CONFIRMED' end||E'\r\n'
    ||case when p_cancel then '' else 'BEGIN:VALARM'||E'\r\n'||'TRIGGER:-PT30M'||E'\r\n'||'ACTION:DISPLAY'||E'\r\n'||'DESCRIPTION:Interview in 30 minutes'||E'\r\n'||'END:VALARM'||E'\r\n' end
    ||'END:VEVENT'||E'\r\n'||'END:VCALENDAR'||E'\r\n';
  -- fold lines longer than 75 characters, as the calendar standard expects
  select string_agg(regexp_replace(l,'(.{74})(?=.)',E'\\1\r\n ','g'),E'\r\n') into ics from unnest(string_to_array(ics,E'\r\n')) l;
  return ics;
end $f$;

-- Calendar invite (or cancellation) to the professional and every member of the company.
create or replace function private.iv_mail(p_iv uuid, p_cancel boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v record; tok text:=private.setting('postmark_token'); co record; pro record; booker record; r record;
  ics text; subj text; heading text; body text; contact text; title text; url text:=private.setting('app_url');
begin
  if tok is null then return; end if;
  select * into v from public.interviews where id=p_iv;
  select c.name, c.private into co from public.companies c where c.id=v.company_id;
  select coalesce(nullif(pp.name,''),pr.name,'The candidate') as name, coalesce(nullif(pp.email,''),u.email) as email, pp.phone, pr.tz
    into pro from auth.users u left join public.pro_private pp on pp.user_id=u.id left join public.profiles pr on pr.user_id=u.id where u.id=v.pro_id;
  select coalesce(nullif(pr.name,''),co.private->>'contact','') as name, coalesce(nullif(pr.title,''),co.private->>'contactTitle','') as title, u.email
    into booker from auth.users u left join public.profiles pr on pr.user_id=u.id where u.id=v.proposed_by;
  title:=private.iv_kind(v.kind)||': '||co.name||' and '||pro.name;
  ics:=private.iv_ics(p_iv,p_cancel,title,booker.name,booker.title,booker.email,co.private->>'phone',pro.name,pro.email,pro.phone);
  -- recipients: the professional, then each company member, each in their own time zone
  for r in
    select 'pro' as side, coalesce(nullif(pro.email,''),u.email) as email, pro.tz as tz from auth.users u where u.id=v.pro_id
    union all
    select 'client', u.email, pr.tz from public.company_members m join auth.users u on u.id=m.user_id left join public.profiles pr on pr.user_id=u.id where m.company_id=v.company_id
    union all
    select 'ct', trim(x), 'Europe/London' from unnest(string_to_array(private.setting('admin_emails'),',')) x
  loop
    continue when coalesce(r.email,'')='' or r.email like '%@ctx-test.dev';
    if p_cancel then
      subj:='Cancelled: '||title; heading:='Interview cancelled';
      body:=private.iv_kind(v.kind)||' on '||private.fmt_local(v.starts_at,r.tz)||' has been cancelled'
        ||case when v.cancelled->>'reason'<>'' then ': '||(v.cancelled->>'reason') else '.' end||' Your calendar should update automatically.';
    else
      contact:=case when r.side='ct'
        then 'Company contact: '||booker.name||coalesce(', '||nullif(booker.title,''),'')||' at '||co.name||', '||coalesce(booker.email,'')||coalesce(', '||nullif(co.private->>'phone',''),'')||'. Candidate: '||pro.name||', '||coalesce(pro.email,'')||coalesce(', '||nullif(pro.phone,''),'')||'. Shown in UK time; your calendar converts it if you are elsewhere.'
        when r.side='pro'
        then 'Your contact at '||co.name||': '||booker.name||coalesce(', '||nullif(booker.title,''),'')||', '||coalesce(booker.email,'')||coalesce(', '||nullif(co.private->>'phone',''),'')||'.'
        else 'Candidate: '||pro.name||', '||coalesce(pro.email,'')||coalesce(', '||nullif(pro.phone,''),'')||'.' end;
      subj:=case when v.seq>0 then 'Updated: ' else 'Booked: ' end||title;
      heading:=case when r.side='ct' then co.name||' is interviewing '||pro.name when v.seq>0 then 'Interview moved' else 'Interview booked' end;
      body:=private.iv_kind(v.kind)||' (round '||v.round||'), '||v.minutes||' minutes, on '||private.fmt_local(v.starts_at,r.tz)||'. '
        ||case v.kind when 'video' then 'Join here: '||v.location||'. ' when 'phone' then coalesce(nullif(v.location,'')||'. ','') else 'Address: '||v.location||'. ' end
        ||contact||' The calendar invite is attached.';
    end if;
    perform net.http_post(url:='https://api.postmarkapp.com/email',
      headers:=jsonb_build_object('Accept','application/json','Content-Type','application/json','X-Postmark-Server-Token',tok),
      body:=jsonb_build_object('From',private.setting('mail_from'),'To',r.email,'Subject',subj,
        'HtmlBody',private.email_html(heading,body,case when r.side='ct' then 'Open interviews' else 'Open the chat' end,url||'#'||case when r.side='pro' then 'messages' when r.side='ct' then 'interviews' else 'chats' end),
        'TextBody',heading||E'\n\n'||body||E'\n\n'||url,'MessageStream','outbound','Tag','interview',
        'Attachments',jsonb_build_array(jsonb_build_object('Name',case when p_cancel then 'cancel.ics' else 'invite.ics' end,
          'Content',encode(convert_to(ics,'UTF8'),'base64'),
          'ContentType','text/calendar; charset=utf-8; method='||case when p_cancel then 'CANCEL' else 'REQUEST' end))));
    insert into private.email_log(to_email,kind,subject) values(r.email,'interview',subj);
  end loop;
end $$;

-- shared bits used by the actions
create or replace function private.iv_sys(p_intro uuid, p_aud text, p_body text) returns void language sql security definer set search_path='' as $$
  insert into public.messages(intro_id,author,side,audience,body,payload) values(p_intro,null,'sys',p_aud,p_body,'{"iv":true}'::jsonb) $$;
create or replace function private.iv_event(v public.interviews, p_what text, p_who text) returns void language sql security definer set search_path='' as $$
  insert into public.events(company_id,pro_id,intro_id,what,who) values(v.company_id,v.pro_id,v.intro_id,p_what,p_who) $$;
create or replace function private.pro_ref(p uuid) returns text language sql stable security definer set search_path='' as $$
  select coalesce(nullif((select name from public.pro_private where user_id=p),''),(select 'Ref '||ref from public.pro_public where user_id=p),'the candidate') $$;

-- ---------- company: propose times (new interview, or new times for an existing one) ----------
create or replace function public.iv_propose(p_intro uuid, p_kind text, p_slots timestamptz[], p_minutes int, p_location text, p_note text, p_iv uuid default null, p_tz text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.intros; v public.interviews; n int; rnd int; was_booked boolean:=false;
begin
  select * into i from public.intros where id=p_intro;
  if i.id is null or not public.member_of(i.company_id) then raise exception 'Only the company in this chat can book interviews'; end if;
  if i.accepted_at is null or i.closed is not null then raise exception 'This chat isn''t open for interviews'; end if;
  if not public.terms_signed(i.company_id) then raise exception 'Sign your terms before booking interviews'; end if;
  n:=coalesce(array_length(p_slots,1),0);
  if n<1 or n>3 then raise exception 'Give between one and three times'; end if;
  if exists(select 1 from unnest(p_slots) s where s<now()+interval '30 minutes') then raise exception 'Every time needs to be in the future'; end if;
  if p_kind not in ('video','phone','in_person') then raise exception 'Choose video, phone or in person'; end if;
  if p_kind in ('video','in_person') and coalesce(trim(p_location),'')='' then raise exception '%', case when p_kind='video' then 'Add the video link' else 'Add the address' end; end if;
  if p_iv is null then
    select coalesce(max(round),0)+1 into rnd from public.interviews where intro_id=p_intro and status<>'cancelled';
    insert into public.interviews(intro_id,company_id,pro_id,round,kind,minutes,slots,location,note,proposed_by,booker_tz)
      values(p_intro,i.company_id,i.pro_id,rnd,p_kind,coalesce(p_minutes,45),p_slots,coalesce(p_location,''),coalesce(p_note,''),auth.uid(),p_tz) returning * into v;
  else
    select * into v from public.interviews where id=p_iv and intro_id=p_intro;
    if v.id is null or v.status in ('held','cancelled') then raise exception 'That interview can''t be changed'; end if;
    was_booked:=v.status='booked';
    update public.interviews set kind=p_kind,minutes=coalesce(p_minutes,45),slots=p_slots,location=coalesce(p_location,''),note=coalesce(p_note,''),
      status='proposed',seq=seq+1,proposed_by=auth.uid(),booker_tz=p_tz,new_times_note=null,updated_at=now() where id=v.id returning * into v;
    if was_booked then perform private.iv_mail(v.id,true); end if;  -- take the old time out of calendars
  end if;
  perform private.iv_sys(p_intro,'both',case when p_iv is null then '' else 'New times suggested. ' end
    ||private.iv_kind(p_kind)||' (round '||v.round||'): '||n||' time'||case when n>1 then 's' else '' end||' suggested. Choose one above.');
  insert into public.notifications(audience,user_id,text,go) values('user',i.pro_id,
    public.co_label(i.company_id)||case when p_iv is null then ' would like to interview you. Choose a time that suits you.' else ' suggested new interview times. Choose one that suits you.' end,'messages');
  perform private.iv_event(v,case when p_iv is null then 'Interview requested (round '||v.round||')' else 'Interview times changed (round '||v.round||')' end,'client');
  return v.id;
end $$;

-- ---------- professional: choose a time ----------
create or replace function public.iv_choose(p_iv uuid, p_slot timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare v public.interviews; co record; pro record; bk record; nm text;
begin
  select * into v from public.interviews where id=p_iv;
  if v.id is null or v.pro_id<>auth.uid() then raise exception 'Only the candidate can choose a time'; end if;
  if v.status<>'proposed' then raise exception 'These times are no longer open'; end if;
  if not (p_slot = any(v.slots)) then raise exception 'Choose one of the suggested times'; end if;
  if p_slot<now() then raise exception 'That time has passed. Ask for new times'; end if;
  update public.interviews set status='booked',starts_at=p_slot,updated_at=now() where id=v.id returning * into v;
  update public.intros set client_state=coalesce(client_state,'{}'::jsonb)||jsonb_build_object('cstage',4) where id=v.intro_id;
  select c.name,c.private into co from public.companies c where c.id=v.company_id;
  select coalesce(nullif(pp.name,''),'The candidate') name, coalesce(nullif(pp.email,''),u.email) email, pp.phone into pro
    from auth.users u left join public.pro_private pp on pp.user_id=u.id where u.id=v.pro_id;
  select coalesce(nullif(pr.name,''),co.private->>'contact','') name, coalesce(nullif(pr.title,''),co.private->>'contactTitle','') title, u.email into bk
    from auth.users u left join public.profiles pr on pr.user_id=u.id where u.id=v.proposed_by;
  nm:=pro.name;
  perform private.iv_sys(v.intro_id,'both','Interview booked: '||private.iv_kind(v.kind)||' (round '||v.round||'). Calendar invites are on their way to both of you by email.');
  -- contact details are shared at booking, each side sees the other's
  perform private.iv_sys(v.intro_id,'client','Contact details for the interview: '||nm||', '||coalesce(pro.email,'')||coalesce(', '||nullif(pro.phone,''),''));
  perform private.iv_sys(v.intro_id,'pro','Contact details for the interview: '||coalesce(nullif(bk.name,''),co.name)||coalesce(', '||nullif(bk.title,''),'')||' at '||co.name||', '||coalesce(bk.email,'')||coalesce(', '||nullif(co.private->>'phone',''),''));
  insert into public.notifications(audience,company_id,text,go) values('company',v.company_id,'Interview booked: '||nm||' confirmed a time for round '||v.round||'.','chats');
  insert into public.notifications(audience,text,go) values('admin','Interview booked: '||co.name||' and '||nm||' (round '||v.round||', '||to_char(v.starts_at at time zone 'Europe/London','DD Mon HH24:MI')||' UK time)','dash');
  perform private.iv_event(v,'Interview booked (round '||v.round||') for '||to_char(v.starts_at at time zone 'UTC','DD Mon YYYY HH24:MI')||' UTC','pro');
  perform private.iv_mail(v.id,false);
end $$;

-- ---------- professional: none of these times work ----------
create or replace function public.iv_new_times(p_iv uuid, p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare v public.interviews;
begin
  select * into v from public.interviews where id=p_iv;
  if v.id is null or v.pro_id<>auth.uid() then raise exception 'Only the candidate can ask for new times'; end if;
  if v.status<>'proposed' then raise exception 'These times are no longer open'; end if;
  update public.interviews set status='new_times',new_times_note=left(coalesce(p_note,''),500),updated_at=now() where id=v.id;
  perform private.iv_sys(v.intro_id,'both','None of the suggested times work.'||case when coalesce(p_note,'')<>'' then ' Note: '||left(p_note,500) else '' end);
  insert into public.notifications(audience,company_id,text,go) values('company',v.company_id,private.pro_ref(v.pro_id)||' asked for different interview times.','chats');
end $$;

-- ---------- either side: cancel ----------
create or replace function public.iv_cancel(p_iv uuid, p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v public.interviews; side text; was_booked boolean;
begin
  select * into v from public.interviews where id=p_iv;
  if v.id is null then raise exception 'Interview not found'; end if;
  side:=case when v.pro_id=auth.uid() then 'pro' when public.member_of(v.company_id) then 'client' end;
  if side is null then raise exception 'Only the people in this chat can cancel'; end if;
  if v.status in ('held','cancelled') then raise exception 'This interview can''t be cancelled'; end if;
  was_booked:=v.status='booked';
  update public.interviews set status='cancelled',seq=seq+1,cancelled=jsonb_build_object('by',side,'reason',left(coalesce(p_reason,''),500),'at',now()),updated_at=now() where id=v.id returning * into v;
  perform private.iv_sys(v.intro_id,'both','Interview cancelled by '||case when side='pro' then 'the candidate' else 'the company' end||case when coalesce(p_reason,'')<>'' then ': '||left(p_reason,500) else '.' end);
  if side='pro' then
    insert into public.notifications(audience,company_id,text,go) values('company',v.company_id,'Interview cancelled: '||private.pro_ref(v.pro_id)||' cancelled round '||v.round||'.','chats');
  else
    insert into public.notifications(audience,user_id,text,go) values('user',v.pro_id,'Interview cancelled: '||public.co_label(v.company_id)||' cancelled round '||v.round||'.','messages');
  end if;
  if was_booked then
    insert into public.notifications(audience,text,go) values('admin','Interview cancelled by the '||case when side='pro' then 'candidate' else 'company' end||': '||(select name from public.companies where id=v.company_id)||' and '||private.pro_ref(v.pro_id)||' (round '||v.round||')','dash');
    perform private.iv_mail(v.id,true);
  end if;
  perform private.iv_event(v,'Interview cancelled (round '||v.round||')',side);
end $$;

-- ---------- company: how did it go ----------
create or replace function public.iv_outcome(p_iv uuid, p_outcome text, p_feedback text) returns void
language plpgsql security definer set search_path='' as $$
declare v public.interviews; co text; nm text;
begin
  select * into v from public.interviews where id=p_iv;
  if v.id is null or not public.member_of(v.company_id) then raise exception 'Only the company can record the outcome'; end if;
  if v.status not in ('booked','held') or v.starts_at>now() then raise exception 'You can record the outcome once the interview has happened'; end if;
  if p_outcome not in ('next','offer','no') then raise exception 'Choose an outcome'; end if;
  update public.interviews set status='held',outcome=p_outcome,updated_at=now() where id=v.id;
  if coalesce(trim(p_feedback),'')<>'' then insert into public.iv_feedback(iv_id,side,author,body) values(v.id,'client',auth.uid(),left(p_feedback,2000)); end if;
  select name into co from public.companies where id=v.company_id; nm:=private.pro_ref(v.pro_id);
  perform private.iv_event(v,'Interview held (round '||v.round||'). Outcome: '||case p_outcome when 'next' then 'another round' when 'offer' then 'making an offer' else 'not progressing' end,'client');
  if p_outcome='offer' then
    update public.intros set client_state=coalesce(client_state,'{}'::jsonb)||jsonb_build_object('cstage',4,'offerOut',true) where id=v.intro_id;
    perform private.iv_sys(v.intro_id,'client','You told Consumer Talent you''re making an offer. Jamie or Connor will be in touch to help.');
    insert into public.notifications(audience,text,go) values('admin','Offer coming: '||co||' plans to make an offer to '||nm||'. Fee protection applies.'||case when coalesce(trim(p_feedback),'')<>'' then ' Their notes: "'||left(p_feedback,140)||'"' else '' end,'dash');
  elsif p_outcome='no' then
    update public.intros set closed=jsonb_build_object('by','client','at',now()),status='closed' where id=v.intro_id and closed is null;
    insert into public.notifications(audience,text,go) values('admin','Drop-out after interview: '||co||' isn''t progressing with '||nm||' (round '||v.round||')'||case when coalesce(trim(p_feedback),'')<>'' then '. Their notes: "'||left(p_feedback,140)||'"' else '' end,'dash');
  else
    perform private.iv_sys(v.intro_id,'client','Noted: another round. Use Book interview to suggest times.');
    insert into public.notifications(audience,text,go) values('admin','Next round: '||co||' wants another interview with '||nm||'.'||case when coalesce(trim(p_feedback),'')<>'' then ' Their notes: "'||left(p_feedback,140)||'"' else '' end,'dash');
  end if;
end $$;

-- ---------- professional: how did it go ----------
create or replace function public.iv_pro_feedback(p_iv uuid, p_feedback text) returns void
language plpgsql security definer set search_path='' as $$
declare v public.interviews;
begin
  select * into v from public.interviews where id=p_iv;
  if v.id is null or v.pro_id<>auth.uid() then raise exception 'Only the candidate can leave this feedback'; end if;
  if v.starts_at is null or v.starts_at>now() then raise exception 'You can leave feedback once the interview has happened'; end if;
  insert into public.iv_feedback(iv_id,side,author,body) values(v.id,'pro',auth.uid(),left(coalesce(p_feedback,''),2000));
  insert into public.notifications(audience,text,go) values('admin','Interview feedback from '||private.pro_ref(v.pro_id)||' about '||(select name from public.companies where id=v.company_id)||': "'||left(p_feedback,120)||'"','dash');
end $$;

revoke execute on function public.iv_propose(uuid,text,timestamptz[],int,text,text,uuid,text), public.iv_choose(uuid,timestamptz), public.iv_new_times(uuid,text),
  public.iv_cancel(uuid,text), public.iv_outcome(uuid,text,text), public.iv_pro_feedback(uuid,text) from public, anon;
grant execute on function public.iv_propose(uuid,text,timestamptz[],int,text,text,uuid,text), public.iv_choose(uuid,timestamptz), public.iv_new_times(uuid,text),
  public.iv_cancel(uuid,text), public.iv_outcome(uuid,text,text), public.iv_pro_feedback(uuid,text) to authenticated;
