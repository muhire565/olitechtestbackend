-- PIN login support for staff (owner, cashier, developer/admin)
-- Run in Supabase SQL editor before using PIN login.

alter table profiles
  add column if not exists pin_hash text,
  add column if not exists pin_lookup text;

create unique index if not exists profiles_pin_lookup_unique
  on profiles (pin_lookup)
  where pin_lookup is not null;

comment on column profiles.pin_hash is 'bcrypt hash of staff PIN (4-6 digits); never store plaintext';
comment on column profiles.pin_lookup is 'SHA-256 lookup key for fast PIN resolution; not reversible';
