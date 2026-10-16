BEGIN;

DO $order_idempotency_preflight$
BEGIN
  IF to_regclass('public.nidor_orders') IS NULL
     OR to_regclass('public.nidor_order_items') IS NULL THEN
    RAISE EXCEPTION 'NIDOR order tables were not found; migration was not applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'nidor_orders'
       AND column_name = 'id'
  ) OR NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'nidor_orders'
       AND column_name = 'subtotal_lkr'
  ) THEN
    RAISE EXCEPTION 'NIDOR order table is missing expected columns; migration was not applied';
  END IF;
END
$order_idempotency_preflight$;

ALTER TABLE public.nidor_orders
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS idempotency_request_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS nidor_orders_idempotency_key_unique
  ON public.nidor_orders (idempotency_key);

ALTER TABLE public.nidor_orders
  DROP CONSTRAINT IF EXISTS nidor_orders_idempotency_pair_check;
ALTER TABLE public.nidor_orders
  ADD CONSTRAINT nidor_orders_idempotency_pair_check
  CHECK (
    (idempotency_key IS NULL AND idempotency_request_hash IS NULL)
    OR (
      idempotency_key IS NOT NULL
      AND idempotency_request_hash IS NOT NULL
      AND idempotency_request_hash ~ '^[0-9a-f]{64}$'
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
