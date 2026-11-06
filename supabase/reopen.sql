-- A professional who declined a request to chat can change their mind and accept it later.
-- The normal "accepted" alerts and protection start still come from intro_notify; this adds the context.
create or replace function public.intro_reopen_note() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='declined' and new.status='accepted' and new.accepted_at is not null then
    insert into public.events(company_id,pro_id,intro_id,what,who) values(new.company_id,new.pro_id,new.id,'Professional changed their mind and accepted after declining ('||new.ref||')','Professional');
    insert into public.messages(intro_id,author,side,audience,body,payload)
      values(new.id,null,'sys','client','Good news: they declined at first but have changed their mind and accepted your request to chat.','{"reopened":true}'::jsonb);
  end if;
  return new;
end $$;
drop trigger if exists intro_reopen_note on public.intros;
create trigger intro_reopen_note after update on public.intros for each row execute function public.intro_reopen_note();
