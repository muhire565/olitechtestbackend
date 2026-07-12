-- Optional: backfill profiles.username from auth.users metadata.
-- Prefer running: node scratch/backfill_profile_usernames.js

-- Manual example for a single user (replace UUID):
-- update profiles set username = 'mugan' where id = '34b7f6f1-a6bb-4526-98e4-28031bb81288' and username is null;
