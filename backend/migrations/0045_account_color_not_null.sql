-- Every account gets a colour when it is created; the grey only fills an
-- older row that never got one.
update account set color = '#888888' where color is null;
alter table account alter column color set not null;
