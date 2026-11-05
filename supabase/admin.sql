-- Consumer Talent Exchange: admin tools
-- Delete an account (test, spam or unwanted sign-ups). Only Jamie and Connor can run it.
-- Safety rule: an account that has had an introduction accepted is on the protection record,
-- so it can't be deleted here (remove the company's access instead).

alter table public.companies drop constraint if exists companies_created_by_fkey;
alter table public.companies add constraint companies_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.messages drop constraint if exists messages_author_fkey;
alter table public.messages add constraint messages_author_fkey foreign key (author) references auth.users(id) on delete set null;

create or replace function public.admin_delete_account(uid uuid) returns text
language plpgsql security definer set search_path='' as $$
declare em text; cos uuid[];
begin
  if not public.is_admin() then raise exception 'Only Consumer Talent can delete accounts'; end if;
  select email into em from auth.users where id=uid;
  if em is null then return 'gone'; end if;
  if em in ('jamie@consumer-talent.com','connor@consumer-talent.com') then raise exception 'Team accounts can''t be deleted here'; end if;
  -- companies only this person belongs to
  select coalesce(array_agg(m.company_id),'{}') into cos from public.company_members m
   where m.user_id=uid and not exists(select 1 from public.company_members o where o.company_id=m.company_id and o.user_id<>uid);
  if exists(select 1 from public.intros i where i.accepted_at is not null and (i.pro_id=uid or i.company_id=any(cos))) then
    raise exception 'This account has introductions on the protection record, so it can''t be deleted. Remove their access instead.';
  end if;
  delete from public.notifications where user_id=uid or company_id=any(cos);
  delete from public.companies where id=any(cos);
  delete from public.waitlist where lower(email)=lower(em);
  delete from auth.users where id=uid;
  return 'deleted';
end $$;
revoke execute on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;

-- ---------- messages to Consumer Talent from inside the Exchange ----------
create table if not exists public.support_msgs(
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  name text, email text, company text, topic text, body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now());
alter table public.support_msgs enable row level security;
drop policy if exists sm_ins on public.support_msgs;
create policy sm_ins on public.support_msgs for insert to authenticated with check (user_id=auth.uid());
drop policy if exists sm_admin on public.support_msgs;
create policy sm_admin on public.support_msgs for select to authenticated using (public.is_admin());

create or replace function public.support_notify() returns trigger language plpgsql security definer set search_path='' as $$
declare tok text:=private.setting('postmark_token'); rcpt text; who text;
begin
  who:=coalesce(nullif(new.name,''),new.email,'Someone')||case when coalesce(new.company,'')<>'' then ' ('||new.company||')' else '' end;
  if new.topic='Retained or project enquiry' then
    insert into public.notifications(audience,text,go) values('admin','Message from '||who||': wants to discuss '||case new.payload->>'kind' when 'Retained search' then 'a retained search' when 'Project' then 'a project' else 'retained search or project work' end||' instead of the standard terms. "'||left(regexp_replace(new.body,'^[^:]*:\s*',''),110)||case when length(new.body)>110 then '…' else '' end||'"','clients');
  elsif new.topic='Terms proposal' and new.payload is not null then
    insert into public.notifications(audience,text,go) values('admin','Message from '||who||': terms proposal of '||(new.payload->>'t1')||'/'||(new.payload->>'t2')||'/'||(new.payload->>'t3')||'% fees, '||(new.payload->>'repl')||'-week replacement, '||(new.payload->>'pay')||'-day payment. Reply by email.','clients');
  else
    insert into public.notifications(audience,text,go) values('admin','Message from '||who||': "'||left(new.body,120)||case when length(new.body)>120 then '…' else '' end||'"','dash');
  end if;
  if tok is null then return new; end if;
  for rcpt in select trim(x) from unnest(string_to_array(private.setting('admin_emails'),',')) x loop
    perform net.http_post(url:='https://api.postmarkapp.com/email',
      headers:=jsonb_build_object('Accept','application/json','Content-Type','application/json','X-Postmark-Server-Token',tok),
      body:=jsonb_build_object('From',private.setting('mail_from'),'To',rcpt,'ReplyTo',coalesce(new.email,''),
        'Subject','CTX message from '||who||case when coalesce(new.topic,'')<>'' then ' · '||new.topic else '' end,
        'HtmlBody',private.email_html('Message from '||who, new.body, 'Open the Exchange', private.setting('app_url')||'#dash')
          ||'<p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#8a857a;text-align:center">Reply to this email to answer '||private.esc(coalesce(new.email,''))||' directly.</p>',
        'TextBody','Message from '||who||' <'||coalesce(new.email,'')||E'>\n\n'||new.body||E'\n\nReply to this email to answer them directly.',
        'MessageStream','outbound','Tag','support'));
  end loop;
  return new;
end $$;
drop trigger if exists support_notify on public.support_msgs;
create trigger support_notify after insert on public.support_msgs for each row execute function public.support_notify();

-- keep the email on file in step when someone changes their sign-in email
create or replace function public.sync_profile_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.email is distinct from old.email then update public.profiles set email=new.email where user_id=new.id; end if;
  return new;
end $$;
drop trigger if exists sync_profile_email on auth.users;
create trigger sync_profile_email after update of email on auth.users for each row execute function public.sync_profile_email();

-- terms proposals arrive as support messages with the proposed figures attached
alter table public.support_msgs add column if not exists payload jsonb;
drop policy if exists sm_own on public.support_msgs;
create policy sm_own on public.support_msgs for select to authenticated using (user_id=auth.uid());
