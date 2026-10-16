BEGIN;

ALTER TABLE public.nidor_order_receipt_email_retries
  ADD COLUMN IF NOT EXISTS provider_email_id text;

CREATE UNIQUE INDEX IF NOT EXISTS nidor_order_receipt_email_provider_id_idx
  ON public.nidor_order_receipt_email_retries (provider_email_id)
  WHERE provider_email_id IS NOT NULL;

ALTER TABLE public.nidor_order_receipt_email_retries
  DROP CONSTRAINT IF EXISTS nidor_order_receipt_email_retries_status_check;
ALTER TABLE public.nidor_order_receipt_email_retries
  ADD CONSTRAINT nidor_order_receipt_email_retries_status_check
  CHECK (status IN ('pending', 'sending', 'accepted', 'exhausted', 'bounced', 'complained'));

CREATE TABLE IF NOT EXISTS public.nidor_receipt_email_webhook_events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 200),
  event_type text NOT NULL CHECK (event_type IN ('email.bounced', 'email.complained')),
  received_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

ALTER TABLE public.nidor_receipt_email_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nidor_receipt_email_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.nidor_receipt_email_webhook_events TO service_role;

COMMIT;
