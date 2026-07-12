# PIN Login Setup Guide

## 1. Run database migration (Supabase SQL Editor)

Execute `scratch/pin_login_migration.sql`:

```sql
alter table profiles
  add column if not exists pin_hash text,
  add column if not exists pin_lookup text;

create unique index if not exists profiles_pin_lookup_unique
  on profiles (pin_lookup)
  where pin_lookup is not null;
```

## 2. Install backend dependency & restart API

```bash
cd olitechbackend
npm install
npm start
```

`bcryptjs` is required for PIN hashing.

## 3. Set initial PINs for existing users

### Option A — Owner self-service (Account Settings)
1. Sign in as owner with password
2. Go to **Settings → Account Settings → Quick PIN Sign-In**
3. Enter a 4–6 digit PIN + current password → **Save PIN**

### Option B — Owner sets cashier PIN when creating account
1. **Settings → Account Settings → Create Cashier Account**
2. Fill name/username/password and optional **Quick PIN** field

### Option C — Developer/admin sets any staff PIN
1. Sign in as **developer** role
2. Go to **Settings → User Account Management**
3. Click the key icon next to a user → set 4–6 digit PIN

### Option D — SQL seed (one-time, requires generating hashes via API)

PINs cannot be inserted as plaintext. Use the API endpoints after migration:

- `PATCH /api/auth/pin` — set your own PIN (requires current password)
- `PATCH /api/users/:id/pin` — developer sets any user; owner sets cashiers only

## API reference

| Endpoint | Auth | Body | Description |
|----------|------|------|-------------|
| `POST /api/auth/login-pin` | Public | `{ "pin": "123456" }` | Fast PIN sign-in |
| `PATCH /api/auth/pin` | User | `{ "pin": "1234", "current_password": "..." }` | Set own PIN |
| `DELETE /api/auth/pin` | User | `{ "current_password": "..." }` | Remove own PIN |
| `PATCH /api/users/:id/pin` | Owner/Developer | `{ "pin": "5678" }` | Set staff PIN |
| `DELETE /api/users/:id/pin` | Owner/Developer | — | Clear staff PIN |

## Security notes

- PINs stored as **bcrypt** (`pin_hash`) + SHA-256 lookup key (`pin_lookup`)
- PIN values are **never logged**
- In-memory rate limit: **8 attempts / 15 min** per IP on `/api/auth/login-pin`
- Each PIN must be **unique** across active staff
- Roles supported: `owner`, `cashier`, `developer` (admin equivalent)

## Optional env

```
PIN_LOOKUP_SECRET=your-random-secret
```

Defaults to `SUPABASE_SERVICE_ROLE_KEY` if unset.
