BEGIN;

-- Fail closed if an object with one of these names exists but is not the
-- expected NIDOR table. This migration never alters or removes existing rows.
DO $migration_preflight$
DECLARE
  relation_kind "char";
  missing_columns text[];
BEGIN
  SELECT c.relkind
    INTO relation_kind
    FROM pg_catalog.pg_class AS c
   WHERE c.oid = pg_catalog.to_regclass('public.products');

  IF relation_kind IS NOT NULL AND relation_kind NOT IN ('r', 'p') THEN
    RAISE EXCEPTION 'public.products exists but is not a table; refusing migration';
  END IF;

  IF relation_kind IS NOT NULL THEN
    SELECT array_agg(expected.column_name)
      INTO missing_columns
      FROM unnest(ARRAY[
        'id', 'name', 'slug', 'brand', 'description', 'fragrance_family',
        'gender', 'concentration', 'top_notes', 'heart_notes', 'base_notes',
        'mood', 'occasion', 'season', 'image_url', 'theme_config',
        'is_active', 'is_featured', 'display_order', 'created_at', 'updated_at'
      ]) AS expected(column_name)
     WHERE NOT EXISTS (
       SELECT 1
         FROM information_schema.columns AS column_info
        WHERE column_info.table_schema = 'public'
          AND column_info.table_name = 'products'
          AND column_info.column_name = expected.column_name
     );
    IF missing_columns IS NOT NULL THEN
      RAISE EXCEPTION 'public.products is missing expected columns: %', missing_columns;
    END IF;
  END IF;

  SELECT c.relkind
    INTO relation_kind
    FROM pg_catalog.pg_class AS c
   WHERE c.oid = pg_catalog.to_regclass('public.product_variants');

  IF relation_kind IS NOT NULL AND relation_kind NOT IN ('r', 'p') THEN
    RAISE EXCEPTION 'public.product_variants exists but is not a table; refusing migration';
  END IF;

  IF relation_kind IS NOT NULL THEN
    SELECT array_agg(expected.column_name)
      INTO missing_columns
      FROM unnest(ARRAY[
        'id', 'product_id', 'size_ml', 'sku', 'price_lkr',
        'price_needs_configuration', 'stock_quantity',
        'stock_needs_configuration', 'is_active', 'created_at', 'updated_at'
      ]) AS expected(column_name)
     WHERE NOT EXISTS (
       SELECT 1
         FROM information_schema.columns AS column_info
        WHERE column_info.table_schema = 'public'
          AND column_info.table_name = 'product_variants'
          AND column_info.column_name = expected.column_name
     );
    IF missing_columns IS NOT NULL THEN
      RAISE EXCEPTION 'public.product_variants is missing expected columns: %', missing_columns;
    END IF;
  END IF;
END
$migration_preflight$;

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  brand text NOT NULL CHECK (length(btrim(brand)) > 0),
  description text NOT NULL DEFAULT '',
  fragrance_family text,
  gender text,
  concentration text,
  top_notes text[] NOT NULL DEFAULT '{}',
  heart_notes text[] NOT NULL DEFAULT '{}',
  base_notes text[] NOT NULL DEFAULT '{}',
  mood text,
  occasion text,
  season text,
  image_url text NOT NULL CHECK (length(btrim(image_url)) > 0),
  theme_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  is_featured boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  size_ml integer NOT NULL CHECK (size_ml IN (5, 10)),
  sku text NOT NULL UNIQUE CHECK (length(btrim(sku)) > 0),
  price_lkr numeric(12, 2) CHECK (price_lkr IS NULL OR price_lkr >= 0),
  price_needs_configuration boolean NOT NULL DEFAULT true,
  stock_quantity integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  stock_needs_configuration boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_product_size_unique UNIQUE (product_id, size_ml)
);

CREATE TABLE IF NOT EXISTS public.nidor_product_admin_allowlist (
  email text PRIMARY KEY
    CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_active_display_order_idx
  ON public.products (display_order, name)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS product_variants_active_product_idx
  ON public.product_variants (product_id, size_ml)
  WHERE is_active;

CREATE OR REPLACE FUNCTION public.nidor_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

DO $updated_at_triggers$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'public.products'::regclass
       AND tgname = 'nidor_products_updated_at'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER nidor_products_updated_at
      BEFORE UPDATE ON public.products
      FOR EACH ROW EXECUTE FUNCTION public.nidor_set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'public.product_variants'::regclass
       AND tgname = 'nidor_product_variants_updated_at'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER nidor_product_variants_updated_at
      BEFORE UPDATE ON public.product_variants
      FOR EACH ROW EXECUTE FUNCTION public.nidor_set_updated_at();
  END IF;
END
$updated_at_triggers$;

CREATE OR REPLACE FUNCTION public.nidor_is_product_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM auth.users AS auth_user
      JOIN public.nidor_product_admin_allowlist AS allowlist
        ON allowlist.email = lower(auth_user.email)
     WHERE auth_user.id = auth.uid()
       AND auth_user.email_confirmed_at IS NOT NULL
  )
$function$;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nidor_product_admin_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nidor_product_admin_allowlist FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nidor_product_admin_allowlist FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.nidor_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nidor_is_product_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nidor_is_product_admin() TO anon, authenticated;
GRANT SELECT ON TABLE public.products, public.product_variants TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.products, public.product_variants TO authenticated;

DO $product_policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'products'
       AND policyname = 'nidor_products_public_read'
  ) THEN
    CREATE POLICY nidor_products_public_read
      ON public.products FOR SELECT TO anon, authenticated
      USING (is_active OR public.nidor_is_product_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'products'
       AND policyname = 'nidor_products_admin_insert'
  ) THEN
    CREATE POLICY nidor_products_admin_insert
      ON public.products FOR INSERT TO authenticated
      WITH CHECK (public.nidor_is_product_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'products'
       AND policyname = 'nidor_products_admin_update'
  ) THEN
    CREATE POLICY nidor_products_admin_update
      ON public.products FOR UPDATE TO authenticated
      USING (public.nidor_is_product_admin())
      WITH CHECK (public.nidor_is_product_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'product_variants'
       AND policyname = 'nidor_variants_public_read'
  ) THEN
    CREATE POLICY nidor_variants_public_read
      ON public.product_variants FOR SELECT TO anon, authenticated
      USING (
        (
          is_active
          AND EXISTS (
            SELECT 1 FROM public.products AS product
             WHERE product.id = product_variants.product_id
               AND product.is_active
          )
        )
        OR public.nidor_is_product_admin()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'product_variants'
       AND policyname = 'nidor_variants_admin_insert'
  ) THEN
    CREATE POLICY nidor_variants_admin_insert
      ON public.product_variants FOR INSERT TO authenticated
      WITH CHECK (public.nidor_is_product_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'product_variants'
       AND policyname = 'nidor_variants_admin_update'
  ) THEN
    CREATE POLICY nidor_variants_admin_update
      ON public.product_variants FOR UPDATE TO authenticated
      USING (public.nidor_is_product_admin())
      WITH CHECK (public.nidor_is_product_admin());
  END IF;
END
$product_policies$;

-- Keep these rows private; only a trusted database administrator can grant
-- product-management access by inserting a confirmed account's email here.
-- The first approved email is installed separately with a bound parameter.

INSERT INTO public.products (
  name, slug, brand, description, fragrance_family, gender, concentration,
  top_notes, heart_notes, base_notes, mood, occasion, season, image_url,
  theme_config, is_active, is_featured, display_order
)
VALUES
  (
    'Hawas Gold Digger', 'gold-digger', 'Rasasi',
    'A woody aromatic composition built around a bright pear, mint, lavender, and bergamot opening.',
    'Woody Aromatic', 'Men', NULL,
    ARRAY['Pear', 'Mint', 'Lavender', 'Bergamot']::text[],
    ARRAY['Cinnamon', 'Sage']::text[],
    ARRAY['Vanilla', 'Amber', 'Cedarwood', 'Patchouli']::text[],
    NULL, NULL, NULL, '/assets/fragrances/hawas-gold-digger.png',
    '{"number":"01","houseDisplay":"Rasasi · Hawas","story":"A BRIGHT STUDY IN CONFIDENCE.","theme":{"surface":"#d9c79f","deep":"#172c53","accent":"#e3bf76","light":true},"visual":{"scale":0.97,"x":0.015,"y":0,"rotation":0}}'::jsonb,
    true, false, 1
  ),
  (
    'Club de Nuit Woman', 'club-woman', 'Armaf',
    'An elegant fragrance with a bright fruity opening, floral heart, and warm musky-vanillic base.',
    'Floral', 'Women', 'Eau de Parfum',
    ARRAY['Bergamot', 'Grapefruit', 'Peach', 'Orange']::text[],
    ARRAY['Geranium', 'Jasmine', 'Litchi', 'Rose']::text[],
    ARRAY['Musk', 'Patchouli', 'Vanilla', 'Vetiver']::text[],
    NULL, NULL, NULL, '/assets/fragrances/armaf-club-de-nuit-woman.png',
    '{"number":"02","houseDisplay":"Armaf","story":"A SOFT CONTRAST IN FULL BLOOM.","theme":{"surface":"#dfc2bc","deep":"#694c55","accent":"#f0d3b0","light":false},"visual":{"scale":1.01,"x":0.012,"y":-0.02,"rotation":0}}'::jsonb,
    true, false, 2
  ),
  (
    'Yara', 'yara', 'Lattafa',
    'A soft, sweet, and creamy fragrance with powdery florals, tropical-gourmand facets, and warm vanilla.',
    'Amber Vanilla', 'Women', NULL,
    ARRAY['Tangerine', 'Heliotrope', 'Orchid']::text[],
    ARRAY['Tropical Notes', 'Gourmand']::text[],
    ARRAY['Vanilla', 'Sandalwood', 'Musk']::text[],
    NULL, NULL, NULL, '/assets/fragrances/lattafa-yara.png',
    '{"number":"03","houseDisplay":"Lattafa","story":"A CREAMY CHAPTER IN PINK.","theme":{"surface":"#edc2c8","deep":"#9c556d","accent":"#f6d4c4","light":false},"visual":{"scale":1.02,"x":-0.08,"y":-0.02,"rotation":0}}'::jsonb,
    true, false, 3
  ),
  (
    'Hawas Chrome', 'hawas-chrome', 'Rasasi',
    'A fruity amber profile shaped by peach, sweet orange, yellow fruits, and a soft musky base.',
    'Fruity / Amber', 'Unisex', NULL,
    ARRAY['Peach', 'Sweet Orange', 'Yellow Fruits']::text[],
    ARRAY['Passion Fruit', 'Fruits', 'Mango', 'Water']::text[],
    ARRAY['Musk', 'Amber', 'Vanilla']::text[],
    NULL, NULL, NULL, '/assets/fragrances/hawas-chrome.png',
    '{"number":"04","houseDisplay":"Rasasi","story":"A COOL LINE THROUGH BRIGHT AIR.","theme":{"surface":"#cbd3d5","deep":"#456a78","accent":"#e9edf0","light":false},"visual":{"scale":1.04,"x":0.024,"y":-0.01,"rotation":0}}'::jsonb,
    true, false, 4
  ),
  (
    'Club de Nuit Intense Man', 'club-intense', 'Armaf',
    'A woody fragrance with a bright fruity-citrus opening, floral-woody heart, and warm musky-ambery base.',
    'Woody', 'Men', NULL,
    ARRAY['Apple', 'Bergamot', 'Blackcurrant', 'Pineapple', 'Lemon']::text[],
    ARRAY['Rose', 'Birch', 'Jasmine']::text[],
    ARRAY['Musk', 'Ambergris', 'Patchouli', 'Vanilla']::text[],
    NULL, NULL, NULL, '/assets/fragrances/armaf-club-de-nuit-intense-man.png',
    '{"number":"05","houseDisplay":"Armaf","story":"A BRIGHT TRACE AFTER DARK.","theme":{"surface":"#85888a","deep":"#191a1c","accent":"#d4ae68","light":true},"visual":{"scale":1.01,"x":-0.005,"y":-0.03,"rotation":0}}'::jsonb,
    true, false, 5
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.product_variants (
  product_id, size_ml, sku, price_lkr, price_needs_configuration,
  stock_quantity, stock_needs_configuration, is_active
)
SELECT product.id,
       size_option.size_ml,
       product.slug || '-' || size_option.size_ml::text || 'ml',
       NULL,
       true,
       0,
       true,
       true
  FROM public.products AS product
 CROSS JOIN (VALUES (5), (10)) AS size_option(size_ml)
 WHERE product.slug IN ('gold-digger', 'club-woman', 'yara', 'hawas-chrome', 'club-intense')
ON CONFLICT (product_id, size_ml) DO NOTHING;

INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
VALUES (
  'product-images',
  'product-images',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $bucket_validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'product-images'
       AND name = 'product-images'
       AND public
  ) THEN
    RAISE EXCEPTION 'The product-images bucket exists with incompatible settings; refusing to change it';
  END IF;
END
$bucket_validation$;

DO $storage_policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'nidor_product_images_public_read'
  ) THEN
    CREATE POLICY nidor_product_images_public_read
      ON storage.objects FOR SELECT TO anon, authenticated
      USING (bucket_id = 'product-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'nidor_product_images_admin_insert'
  ) THEN
    CREATE POLICY nidor_product_images_admin_insert
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'product-images'
        AND public.nidor_is_product_admin()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'nidor_product_images_admin_update'
  ) THEN
    CREATE POLICY nidor_product_images_admin_update
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'product-images'
        AND public.nidor_is_product_admin()
      )
      WITH CHECK (
        bucket_id = 'product-images'
        AND public.nidor_is_product_admin()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'nidor_product_images_admin_delete'
  ) THEN
    CREATE POLICY nidor_product_images_admin_delete
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'product-images'
        AND public.nidor_is_product_admin()
      );
  END IF;
END
$storage_policies$;

NOTIFY pgrst, 'reload schema';
COMMIT;