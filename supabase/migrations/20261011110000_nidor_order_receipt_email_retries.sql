BEGIN;

CREATE TABLE IF NOT EXISTS public.nidor_order_receipt_email_retries (
  order_id uuid PRIMARY KEY REFERENCES public.nidor_orders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'accepted', 'exhausted')),
  attempt_count smallint NOT NULL DEFAULT 1
    CHECK (attempt_count BETWEEN 1 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT statement_timestamp() + INTERVAL '1 minute',
  last_attempt_at timestamptz,
  lease_expires_at timestamptz,
  accepted_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) <= 64),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT nidor_order_receipt_email_retries_status_fields_check CHECK (
    (status = 'sending' AND lease_expires_at IS NOT NULL)
    OR (status <> 'sending' AND lease_expires_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS nidor_order_receipt_email_retries_due_idx
  ON public.nidor_order_receipt_email_retries (next_attempt_at, order_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS nidor_order_receipt_email_retries_lease_idx
  ON public.nidor_order_receipt_email_retries (lease_expires_at, order_id)
  WHERE status = 'sending';

ALTER TABLE public.nidor_order_receipt_email_retries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nidor_order_receipt_email_retries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.nidor_order_receipt_email_retries
  TO service_role;

COMMIT;
