BEGIN;

-- Fail closed if this is not the NIDOR catalog schema this migration extends.
DO $migration_preflight$
BEGIN
  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.product_variants') IS NULL THEN
    RAISE EXCEPTION 'NIDOR product catalog tables were not found; migration was not applied';
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_variants'
      AND column_name = ANY (ARRAY[
        'product_id', 'size_ml', 'sku', 'price_lkr',
        'stock_quantity', 'is_active'
      ])
  ) <> 6 THEN
    RAISE EXCEPTION 'product_variants does not match the expected NIDOR schema';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.product_variants'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on product_variants; migration was not applied';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.product_variants
    WHERE size_ml NOT IN (5, 10)
       OR stock_quantity < 0
       OR (price_lkr IS NOT NULL AND price_lkr < 0)
  ) THEN
    RAISE EXCEPTION 'Existing variant data failed preflight validation; migration was not applied';
  END IF;
END
$migration_preflight$;

-- Existing rows receive the safe type only. IDs, prices, stock, SKUs, and
-- active/configuration flags are not rewritten.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS variant_type text NOT NULL DEFAULT 'decant';

ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS product_variants_size_ml_check;

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_type_size_check
  CHECK (
    (variant_type = 'decant' AND size_ml IN (5, 10))
    OR (variant_type = 'full_bottle' AND size_ml > 0)
  );

-- Replace decant-only uniqueness with type + actual volume. A product has one
-- full-bottle option; its real volume is entered by an administrator.
ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS product_variants_product_size_unique;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_type_size_unique
  ON public.product_variants (product_id, variant_type, size_ml);

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_one_full_bottle_per_product
  ON public.product_variants (product_id)
  WHERE variant_type = 'full_bottle';

NOTIFY pgrst, 'reload schema';

COMMIT;
