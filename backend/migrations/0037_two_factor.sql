-- Second factors (#12, #57). A user has two-factor on when they have a
-- confirmed user_totp row or at least one user_passkey: no separate flag.

create table user_totp (
    user_id        uuid primary key references users (id) on delete cascade,
    -- base64(nonce || AES-256-GCM ciphertext) under ENCRYPTION_KEY, like provider credentials.
    secret_enc     text not null,
    -- Null while being set up; only confirmed rows count.
    confirmed_at   timestamptz,
    -- The last 30-second step accepted, so one code can't be used twice.
    last_used_step bigint,
    created_at     timestamptz not null default now()
);

create table user_recovery_code (
    id        uuid primary key default gen_random_uuid(),
    user_id   uuid not null references users (id) on delete cascade,
    -- SHA-256 of the normalised code (random, so no slow hash needed).
    code_hash bytea not null,
    used_at   timestamptz
);
create index user_recovery_code_user on user_recovery_code (user_id);

create table user_passkey (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references users (id) on delete cascade,
    credential_id bytea not null unique,
    passkey       jsonb not null,
    name          text not null,
    created_at    timestamptz not null default now(),
    last_used_at  timestamptz
);
create index user_passkey_user on user_passkey (user_id);

-- Short-lived, single-use proofs between two requests: the second login step,
-- passkey ceremonies, and a fresh re-authentication.
create table login_challenge (
    id         uuid primary key default gen_random_uuid(),
    token_hash bytea not null unique,
    user_id    uuid references users (id) on delete cascade,
    kind       text not null check (kind in ('mfa', 'passkey_login', 'passkey_register', 'reauth')),
    state      jsonb not null default '{}',
    expires_at timestamptz not null
);
create index login_challenge_expires on login_challenge (expires_at);
