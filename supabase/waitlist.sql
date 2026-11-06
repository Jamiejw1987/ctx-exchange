-- Launch list: tell Jamie and Connor about every new sign-up (push, bell and email via the notifications triggers)
create or replace function public.waitlist_notify() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(audience,text,go) values('admin',
    'Launch list: '||coalesce(nullif(new.name,''),new.email)||case when new.side='client' then ' from '||coalesce(nullif(new.company,''),'a company')||coalesce(' ('||nullif(new.role,'')||')','')||' wants to hire through the Exchange'
      else coalesce(' ('||nullif(new.title,'')||coalesce(', '||nullif(new.region,''),'')||')','')||' joined as a professional' end||'.','waitlist');
  return new;
end $$;
drop trigger if exists waitlist_notify on public.waitlist;
create trigger waitlist_notify after insert on public.waitlist for each row execute function public.waitlist_notify();

-- the team can remove duplicate or test entries from the launch list
drop policy if exists "team can delete" on public.waitlist;
create policy "team can delete" on public.waitlist for delete to authenticated using (public.is_admin());
