-- No provider produces crypto accounts or instruments.
delete from account_type where key = 'crypto';
