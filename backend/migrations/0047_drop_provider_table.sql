-- Account providers are listed in code (`gripsou_jobs::ACCOUNT_PROVIDERS`),
-- so adding one needs no migration. Only the admin's on/off choice stays here.
-- Price providers ignore that choice, so the `yahoo` entry goes too.
alter table connection drop constraint connection_provider_key_fkey;
drop table provider;
update app_settings set enabled_providers = array_remove(enabled_providers, 'yahoo');
