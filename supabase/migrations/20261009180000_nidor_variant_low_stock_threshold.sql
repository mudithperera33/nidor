BEGIN;

DO $migration_preflight$
DECLARE
  threshold_type text;
BEGIN
  IF to_regclass('public.product_variants') IS NULL THEN
    RAISE EXCEPTION 'NIDOR product_variants table was not found; migration was not applied';
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_variants'
      AND column_name = ANY (ARRAY[
        'product_id', 'stock_quantity', 'stock_needs_configuration', 'is_active'
      ])
  ) <> 4 THEN
    RAISE EXCEPTION 'product_variants does not match the expected NIDOR schema';
  END IF;

  SELECT data_type
    INTO threshold_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'product_variants'
     AND column_name = 'low_stock_threshold';
  IF threshold_type IS NOT NULL AND threshold_type <> 'integer' THEN
    RAISE EXCEPTION 'product_variants.low_stock_threshold exists with an unexpected type';
  END IF;
END
$migration_preflight$;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer;

DO $threshold_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.product_variants'::regclass
       AND conname = 'product_variants_low_stock_threshold_check'
  ) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_low_stock_threshold_check
      CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0);
  END IF;
END
$threshold_constraint$;

COMMENT ON COLUMN public.product_variants.low_stock_threshold IS
  'Optional per-variant stock warning threshold; NULL means no low-stock warning.';

NOTIFY pgrst, 'reload schema';

COMMIT;
