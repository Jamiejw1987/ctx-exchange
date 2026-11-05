-- Consumer Talent Exchange: email alerts through Postmark
-- Every in-app notification also goes out by email, sent from the database with pg_net.
-- The Postmark token lives in private.settings (not exposed to the app, never in this repo):
--   insert into private.settings(key,value) values('postmark_token','<server token>')
--   on conflict(key) do update set value=excluded.value;

create extension if not exists pg_net;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.settings(key text primary key, value text not null);
insert into private.settings(key,value) values
  ('mail_from','Consumer Talent Exchange <noreply@consumer-talent.com>'),
  ('app_url','https://jamiejw1987.github.io/ctx-exchange/exchange/'),
  ('admin_emails','jamie@consumer-talent.com,connor@consumer-talent.com')
on conflict(key) do nothing;

create table if not exists private.email_log(
  id bigint generated always as identity primary key,
  to_email text not null, kind text not null, subject text,
  request_id bigint, created_at timestamptz not null default now());
create index if not exists email_log_to_kind on private.email_log(to_email,kind,created_at desc);

create or replace function private.setting(k text) returns text language sql stable security definer set search_path='' as $$
  select value from private.settings where key=k $$;

create or replace function private.esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;') $$;

-- branded HTML shell shared by every alert
create or replace function private.email_html(heading text, body text, button text, url text) returns text language sql immutable as $$
select '<!doctype html><html><body style="margin:0;padding:0;background:#f4f1ea;font-family:Helvetica,Arial,sans-serif;color:#1c1b19">'
 ||'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:28px 12px"><tr><td align="center">'
 ||'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e6e0d3">'
 ||'<tr><td style="padding:22px 28px;background:#141414;border-radius:14px 14px 0 0"><span style="font-size:15px;font-weight:700;color:#f2efe8;letter-spacing:.2px">Consumer Talent <span style="color:#c8a96b">Exchange</span></span></td></tr>'
 ||'<tr><td style="padding:28px">'
 ||'<h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;color:#141414">'||private.esc(heading)||'</h1>'
 ||'<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4a4740">'||private.esc(body)||'</p>'
 ||'<a href="'||url||'" style="display:inline-block;background:#c8a96b;color:#141414;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:999px">'||private.esc(button)||'</a>'
 ||'</td></tr>'
 ||'<tr><td style="padding:18px 28px;border-top:1px solid #eee8db;font-size:12px;line-height:1.5;color:#8a857a">Consumer Talent Exchange · Just meaningful introductions.<br>You''re getting this because you have an account on the Exchange.</td></tr>'
 ||'</table></td></tr></table></body></html>' $$;

create or replace function private.send_email(to_email text, subject text, heading text, body text, button text, url text, kind text)
returns void language plpgsql security definer set search_path='' as $$
declare tok text:=private.setting('postmark_token'); rid bigint;
begin
  if tok is null or coalesce(to_email,'')='' or to_email like '%@ctx-test.dev' then return; end if;
  select net.http_post(
    url:='https://api.postmarkapp.com/email',
    headers:=jsonb_build_object('Accept','application/json','Content-Type','application/json','X-Postmark-Server-Token',tok),
    body:=jsonb_build_object('From',private.setting('mail_from'),'To',to_email,'Subject',subject,
      'HtmlBody',private.email_html(heading,body,button,url),
      'TextBody',heading||E'\n\n'||body||E'\n\n'||button||': '||url,
      'MessageStream','outbound','Tag',kind)) into rid;
  insert into private.email_log(to_email,kind,subject,request_id) values(to_email,kind,subject,rid);
end $$;

-- fan each notification out to the right inboxes
create or replace function public.notification_email() returns trigger language plpgsql security definer set search_path='' as $$
declare
  url text:=private.setting('app_url')||'#'||coalesce(nullif(new.go,''),'');
  kind text:=case when new.text like 'New message%' then 'message' else 'alert' end;
  rcpt text; subj text; body text; btn text;
begin
  if new.audience='admin' then
    -- professionals join automatically, so no email for each one; everything else needs a look
    if new.text like 'New professional joined%' then return new; end if;
    subj:='CTX: '||left(new.text,110); body:='Open the Exchange to take a look.'; btn:='Open the Exchange';
    for rcpt in select trim(x) from unnest(string_to_array(private.setting('admin_emails'),',')) x loop
      perform private.send_email(rcpt,subj,new.text,body,btn,url,'admin');
    end loop;
    return new;
  end if;
  if new.audience='user' then
    subj:=left(new.text,120);
    body:='Sign in to the Exchange to see it. Your name and employer stay hidden until you choose to share them.';
    btn:='Open the Exchange';
    for rcpt in select u.email from auth.users u where u.id=new.user_id loop
      -- chats: one email per 15 minutes per person, so a busy conversation doesn't flood their inbox
      if kind='message' and exists(select 1 from private.email_log l where l.to_email=rcpt and l.kind='message' and l.created_at>now()-interval '15 minutes') then continue; end if;
      perform private.send_email(rcpt,subj,new.text,body,btn,url,kind);
    end loop;
    return new;
  end if;
  if new.audience='company' then
    subj:=left(new.text,120); body:='Sign in to the Exchange to see more.'; btn:='Open the Exchange';
    for rcpt in select u.email from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=new.company_id loop
      if kind='message' and exists(select 1 from private.email_log l where l.to_email=rcpt and l.kind='message' and l.created_at>now()-interval '15 minutes') then continue; end if;
      perform private.send_email(rcpt,subj,new.text,body,btn,url,kind);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists notification_email on public.notifications;
create trigger notification_email after insert on public.notifications for each row execute function public.notification_email();
revoke execute on function public.notification_email() from public, anon, authenticated;
