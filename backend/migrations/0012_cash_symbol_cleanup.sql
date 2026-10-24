-- Cash instruments have no display symbol.
update instrument set symbol = null where kind = 'cash' and symbol is not null;
