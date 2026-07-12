# Recovery: Login fails after PIN attempt

## What we found (live DB check)

- Owner account (`Mungan` / `mugan`) has **`pin_hash: null` and `pin_lookup: null`** — the PIN was never persisted.
- Auth user is unchanged: `olitech@gmail.com`, metadata username `mugan`.
- Password was **not** changed by the PIN endpoint (PIN set only verifies password, never updates it).

## Likely causes

1. **PIN save failed or was never completed** — user may have seen a success toast from an older build, or the save failed silently before post-save verification was added.
2. **Credentials form confusion** — Account Security form can change password if "New Password" is filled. PIN form is separate; entering digits in the wrong form would change the password to those digits.
3. **Username field showed email** — old UI defaulted username input to `user.email`, and submitting credentials could overwrite sign-in metadata.

## User recovery steps

### If password no longer works

1. **Supabase Dashboard** → Authentication → Users → find `olitech@gmail.com` → Reset password.
2. Or a **developer** uses User Account Management / admin tools to reset access.
3. Sign in with the new password, then set PIN again via **Quick PIN Sign-In** (not Account Security).

### Sign-in identifiers that work

| Identifier | Maps to |
|------------|---------|
| `mugan` | auth metadata username |
| `mungan` | profiles.full_name |
| `olitech@gmail.com` | email |

### After fix is deployed

1. Restart backend.
2. Sign in with password.
3. Account Settings → **Quick PIN Sign-In** → enter PIN + current password → **Save PIN**.
4. Confirm toast: "PIN saved. Your password was not changed."
5. Log out and test PIN tab.

## Admin: verify PIN saved

```bash
cd olitechbackend
node scratch/diagnose_post_pin.js
```

Owner row should show `pin_hash` and `pin_lookup` populated after save.
