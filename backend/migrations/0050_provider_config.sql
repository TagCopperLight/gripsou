-- Provider keys entered in Settings → Server (#63): provider key → base64 of
-- the AES-GCM-encrypted JSON object of its fields, under ENCRYPTION_KEY.
alter table app_settings
    add column provider_config jsonb not null default '{}';
