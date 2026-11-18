-- STEP 4 – Run AFTER you registered your own account on the website.
-- Replace the e-mail address with the one you registered with.
insert into public.user_roles (user_id, role)
select id, 'super_admin' from auth.users where email = 'UW-EMAIL@VOORBEELD.SR'
on conflict do nothing;

-- Check: should return one row with role super_admin
select u.email, r.role from auth.users u join public.user_roles r on r.user_id = u.id where r.role = 'super_admin';
