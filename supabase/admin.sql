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
