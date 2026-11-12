-- A reset link names the user it resets, not an address: an email change
-- must not break it, and an address someone else takes later must not lead
-- to their account. Open links whose address no longer matches anyone can
-- reset nothing, so they go.
alter table invite_token
    add column user_id uuid references users (id) on delete cascade;

update invite_token t
   set user_id = u.id
  from users u
 where t.type = 'reset' and u.email = t.email;

delete from invite_token where type = 'reset' and user_id is null;

alter table invite_token
    drop column email,
    add constraint invite_token_user_check check ((type = 'reset') = (user_id is not null));
