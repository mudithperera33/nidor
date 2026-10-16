BEGIN;

CREATE TABLE IF NOT EXISTS public.nidor_order_rate_limit_counters (
  scope text NOT NULL CHECK (scope IN ('nidor:create-order', 'nidor:recover-receipt')),
  client_key_hash text NOT NULL CHECK (client_key_hash ~ '^[0-9a-f]{64}$'),
  total_hits integer NOT NULL CHECK (total_hits >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, client_key_hash)
);

CREATE INDEX IF NOT EXISTS nidor_order_rate_limit_counters_expires_at_idx
  ON public.nidor_order_rate_limit_counters (expires_at);

ALTER TABLE public.nidor_order_rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nidor_order_rate_limit_counters
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nidor_order_rate_limit_counters
  TO service_role;

COMMIT;
