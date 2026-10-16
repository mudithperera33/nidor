BEGIN;

DO $migration_preflight$
DECLARE
  relation_kind "char";
  missing_columns text[];
BEGIN
  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.product_variants') IS NULL THEN
    RAISE EXCEPTION 'NIDOR catalog tables were not found; order tables were not created';
  END IF;

  SELECT array_agg(expected.column_name)
    INTO missing_columns
    FROM unnest(ARRAY[
      'id', 'name', 'brand', 'is_active'
    ]) AS expected(column_name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name = expected.column_name
   );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'public.products is missing expected columns: %', missing_columns;
  END IF;

  SELECT array_agg(expected.column_name)
    INTO missing_columns
    FROM unnest(ARRAY[
      'id', 'product_id', 'variant_type', 'size_ml', 'price_lkr',
      'price_needs_configuration', 'stock_quantity',
      'stock_needs_configuration', 'is_active'
    ]) AS expected(column_name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'product_variants'
        AND column_name = expected.column_name
   );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'public.product_variants is missing expected columns: %', missing_columns;
  END IF;

  SELECT c.relkind INTO relation_kind
    FROM pg_catalog.pg_class AS c
   WHERE c.oid = pg_catalog.to_regclass('public.nidor_orders');
  IF relation_kind IS NOT NULL AND relation_kind NOT IN ('r', 'p') THEN
    RAISE EXCEPTION 'public.nidor_orders exists but is not a table; refusing migration';
  END IF;
  IF relation_kind IS NOT NULL THEN
    SELECT array_agg(expected.column_name)
      INTO missing_columns
      FROM unnest(ARRAY[
        'id', 'customer_name', 'customer_email', 'customer_phone',
        'delivery_address', 'status', 'subtotal_lkr', 'created_at'
      ]) AS expected(column_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'nidor_orders'
          AND column_name = expected.column_name
     );
    IF missing_columns IS NOT NULL THEN
      RAISE EXCEPTION 'public.nidor_orders is missing expected columns: %', missing_columns;
    END IF;
  END IF;

  SELECT c.relkind INTO relation_kind
    FROM pg_catalog.pg_class AS c
   WHERE c.oid = pg_catalog.to_regclass('public.nidor_order_items');
  IF relation_kind IS NOT NULL AND relation_kind NOT IN ('r', 'p') THEN
    RAISE EXCEPTION 'public.nidor_order_items exists but is not a table; refusing migration';
  END IF;
  IF relation_kind IS NOT NULL THEN
    SELECT array_agg(expected.column_name)
      INTO missing_columns
      FROM unnest(ARRAY[
        'id', 'order_id', 'variant_id', 'product_name_snapshot', 'brand_snapshot',
        'variant_type_snapshot', 'size_ml_snapshot', 'unit_price_lkr', 'quantity',
        'line_total_lkr', 'created_at'
      ]) AS expected(column_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'nidor_order_items'
          AND column_name = expected.column_name
     );
    IF missing_columns IS NOT NULL THEN
      RAISE EXCEPTION 'public.nidor_order_items is missing expected columns: %', missing_columns;
    END IF;
  END IF;
END
$migration_preflight$;

CREATE TABLE IF NOT EXISTS public.nidor_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 2 AND 120),
  customer_email text NOT NULL CHECK (length(customer_email) BETWEEN 3 AND 320),
  customer_phone text NOT NULL CHECK (length(btrim(customer_phone)) BETWEEN 7 AND 40),
  delivery_address text NOT NULL CHECK (length(btrim(delivery_address)) BETWEEN 8 AND 800),
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'fulfilled')),
  subtotal_lkr numeric(14, 2) NOT NULL CHECK (subtotal_lkr >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nidor_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.nidor_orders(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  brand_snapshot text NOT NULL,
  variant_type_snapshot text NOT NULL CHECK (variant_type_snapshot IN ('decant', 'full_bottle')),
  size_ml_snapshot integer NOT NULL CHECK (size_ml_snapshot > 0),
  unit_price_lkr numeric(12, 2) NOT NULL CHECK (unit_price_lkr >= 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total_lkr numeric(14, 2) NOT NULL CHECK (line_total_lkr >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nidor_order_items_order_variant_unique UNIQUE (order_id, variant_id)
);

CREATE INDEX IF NOT EXISTS nidor_orders_created_at_idx
  ON public.nidor_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS nidor_orders_status_created_at_idx
  ON public.nidor_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS nidor_order_items_order_id_idx
  ON public.nidor_order_items (order_id);

ALTER TABLE public.nidor_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nidor_order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nidor_orders, public.nidor_order_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.nidor_orders, public.nidor_order_items TO service_role;
GRANT SELECT, UPDATE ON TABLE public.product_variants TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
