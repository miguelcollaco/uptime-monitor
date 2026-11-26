-- Starter monitors. Edit the names and URLs, then run:
--   pnpm db:seed:local    (for `pnpm dev`)
--   pnpm db:seed:remote   (for the deployed Worker)
-- You can also add monitors later through the admin API (see README).
INSERT INTO monitors (name, url, created_at) VALUES
  ('Personal site', 'https://miguelcollaco.com', unixepoch() * 1000),
  ('GitHub',        'https://github.com',        unixepoch() * 1000),
  ('Example (should be down)', 'https://this-domain-should-not-exist.invalid', unixepoch() * 1000);
