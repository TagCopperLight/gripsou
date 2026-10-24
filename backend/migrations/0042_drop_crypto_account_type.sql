-- No provider produces crypto accounts or instruments. An account a user filed
-- as crypto becomes a brokerage account, so the type can go.
update account set type_key = 'brokerage' where type_key = 'crypto';
delete from account_type where key = 'crypto';
