-- Yahoo FX pair symbols (`CNYEUR=X`) leaked into the display `symbol` of cash
-- instruments. They are a fetch detail; meta.yahoo_symbol already holds them.
update instrument set symbol = null where kind = 'cash' and symbol is not null;
