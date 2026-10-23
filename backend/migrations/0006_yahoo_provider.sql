update provider
set key = 'yahoo',
    display_name = 'Yahoo Finance',
    description = 'Daily market prices for securities, used to value holdings and chart their history.'
where key = 'marketdata';

update app_settings
set enabled_providers = array_replace(enabled_providers, 'marketdata', 'yahoo');
