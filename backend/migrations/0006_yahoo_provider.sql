-- Rename the seeded 'marketdata' price-provider catalog row to 'yahoo', matching
-- the PriceProvider adapter key. No connection references it (it is a price
-- provider, not an account provider), so updating the PK is safe.
update provider
set key = 'yahoo',
    display_name = 'Yahoo Finance',
    description = 'Daily market prices for securities, used to value holdings and chart their history.'
where key = 'marketdata';

update app_settings
set enabled_providers = array_replace(enabled_providers, 'marketdata', 'yahoo');
