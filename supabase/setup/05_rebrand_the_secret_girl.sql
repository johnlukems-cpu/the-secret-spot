-- STEP 5 – Rename the store to THE SECRET GIRL in data that is already in the database
-- (settings, payment disclaimer, e-mail/WhatsApp templates, homepage blocks).
-- Safe to run more than once. New installations already get the new name from 02_configuration.sql.

update public.business_settings
   set value = to_jsonb(replace(replace(replace(value #>> '{}', 'THE SECRET SPOT', 'THE SECRET GIRL'), 'The Secret Spot', 'The Secret Girl'), 'SECRET SPOT', 'SECRET GIRL'))
 where jsonb_typeof(value) = 'string' and value #>> '{}' ilike '%secret spot%';

update public.notification_templates
   set subject = replace(replace(subject, 'THE SECRET SPOT', 'THE SECRET GIRL'), 'The Secret Spot', 'The Secret Girl'),
       body    = replace(replace(body,    'THE SECRET SPOT', 'THE SECRET GIRL'), 'The Secret Spot', 'The Secret Girl')
 where subject ilike '%secret spot%' or body ilike '%secret spot%';

update public.site_content
   set title    = replace(replace(title,    'THE SECRET SPOT', 'THE SECRET GIRL'), 'The Secret Spot', 'The Secret Girl'),
       subtitle = replace(replace(subtitle, 'THE SECRET SPOT', 'THE SECRET GIRL'), 'The Secret Spot', 'The Secret Girl'),
       body     = replace(replace(body,     'THE SECRET SPOT', 'THE SECRET GIRL'), 'The Secret Spot', 'The Secret Girl')
 where coalesce(title, '') || coalesce(subtitle, '') || coalesce(body, '') ilike '%secret spot%';

-- Check: should return 0
select (select count(*) from public.business_settings where value::text ilike '%secret spot%')
     + (select count(*) from public.notification_templates where coalesce(subject,'') || body ilike '%secret spot%') as remaining_old_name;
