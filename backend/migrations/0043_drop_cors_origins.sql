-- The SPA is served by the same binary: no other origin calls the API.
alter table app_settings drop column cors_origins;
