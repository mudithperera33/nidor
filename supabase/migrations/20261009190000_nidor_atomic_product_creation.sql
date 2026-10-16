BEGIN;

-- Fail closed unless the checked-in catalog, admin RLS, storage bucket, and
-- low-stock migration are present in the expected shape.
DO $product_creation_preflight$
DECLARE
  missing_columns text[];
BEGIN
  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.product_variants') IS NULL
     OR to_regclass('public.nidor_product_admin_allowlist') IS NULL THEN
    RAISE EXCEPTION 'NIDOR catalog tables were not found; migration was not applied';
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_columns
    FROM (VALUES
      ('products', 'id'),
      ('products', 'name'),
      ('products', 'slug'),
      ('products', 'brand'),
      ('products', 'description'),
      ('products', 'fragrance_family'),
      ('products', 'gender'),
      ('products', 'concentration'),
      ('products', 'top_notes'),
      ('products', 'heart_notes'),
      ('products', 'base_notes'),
      ('products', 'mood'),
      ('products', 'occasion'),
      ('products', 'season'),
      ('products', 'image_url'),
      ('products', 'theme_config'),
      ('products', 'is_active'),
      ('products', 'is_featured'),
      ('products', 'display_order'),
      ('product_variants', 'product_id'),
      ('product_variants', 'variant_type'),
      ('product_variants', 'size_ml'),
      ('product_variants', 'sku'),
      ('product_variants', 'price_lkr'),
      ('product_variants', 'price_needs_configuration'),
      ('product_variants', 'stock_quantity'),
      ('product_variants', 'stock_needs_configuration'),
      ('product_variants', 'low_stock_threshold'),
      ('product_variants', 'is_active')
    ) AS required(table_name, column_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = required.table_name
        AND actual.column_name = required.column_name
   );

  IF cardinality(missing_columns) > 0 THEN
    RAISE EXCEPTION 'NIDOR product schema is missing required columns: %', missing_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.products'::regclass AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.product_variants'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Product RLS must remain enabled; migration was not applied';
  END IF;

  IF to_regprocedure('public.nidor_is_product_admin()') IS NULL THEN
    RAISE EXCEPTION 'NIDOR product-admin authorization function is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'product-images'
       AND name = 'product-images'
       AND public
  ) THEN
    RAISE EXCEPTION 'The public product-images bucket is missing or has incompatible settings';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'nidor_product_images_admin_insert'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'nidor_product_images_admin_delete'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'nidor_product_images_public_read'
  ) THEN
    RAISE EXCEPTION 'Product image read and admin cleanup policies are missing';
  END IF;
END
$product_creation_preflight$;

-- PostgREST invokes this as the caller (not as a privileged definer). The
-- catalog's existing RLS policies and allowlist function remain authoritative.
CREATE OR REPLACE FUNCTION public.nidor_create_product_with_variants(
  p_product jsonb,
  p_variants jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $product_creation$
DECLARE
  v_name text;
  v_slug text;
  v_brand text;
  v_description text;
  v_gender text;
  v_image_url text;
  v_storage_object_name text;
  v_theme_config jsonb;
  v_is_active boolean;
  v_is_featured boolean;
  v_display_order integer;
  v_product_id uuid;
  v_variant jsonb;
  v_note jsonb;
  v_notes jsonb;
  v_variant_type text;
  v_size_text text;
  v_size_ml integer;
  v_sku text;
  v_price_text text;
  v_price_lkr numeric(12, 2);
  v_price_needs_configuration boolean;
  v_stock_text text;
  v_stock_quantity integer;
  v_stock_needs_configuration boolean;
  v_threshold_text text;
  v_low_stock_threshold integer;
  v_variant_is_active boolean;
  v_has_5ml boolean := false;
  v_has_10ml boolean := false;
  v_has_full_bottle boolean := false;
  v_has_publishable_variant boolean := false;
BEGIN
  IF NOT public.nidor_is_product_admin() THEN
    RAISE EXCEPTION 'Only authorized product administrators can create products'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_product) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Product details must be an object'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_variants) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_variants) NOT BETWEEN 2 AND 3 THEN
    RAISE EXCEPTION 'Provide the 5 ml and 10 ml decants, with at most one full bottle'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_product -> 'name') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_product -> 'brand') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_product -> 'slug') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_product -> 'image_url') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Product name, brand, slug, and uploaded image are required'
      USING ERRCODE = '22023';
  END IF;

  v_name := btrim(p_product ->> 'name');
  v_brand := btrim(p_product ->> 'brand');
  v_slug := lower(btrim(p_product ->> 'slug'));
  v_description := coalesce(btrim(p_product ->> 'description'), '');
  v_gender := nullif(btrim(p_product ->> 'gender'), '');
  v_image_url := btrim(p_product ->> 'image_url');

  IF v_name = '' OR v_brand = '' THEN
    RAISE EXCEPTION 'Product name and brand are required'
      USING ERRCODE = '22023';
  END IF;
  IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Use a URL slug made of lowercase letters, numbers, and hyphens'
      USING ERRCODE = '22023';
  END IF;
  IF v_gender IS NOT NULL AND v_gender NOT IN ('Men', 'Women', 'Unisex') THEN
    RAISE EXCEPTION 'Choose Men, Women, or Unisex for the audience'
      USING ERRCODE = '22023';
  END IF;
  IF v_image_url !~ '^https?://[^/]+/storage/v1/object/public/product-images/.+' THEN
    RAISE EXCEPTION 'Upload a product image to the authorized product-images bucket before saving'
      USING ERRCODE = '22023';
  END IF;
  v_storage_object_name := regexp_replace(
    v_image_url,
    '^https?://[^/]+/storage/v1/object/public/product-images/',
    ''
  );
  IF NOT EXISTS (
    SELECT 1
      FROM storage.objects
     WHERE bucket_id = 'product-images'
       AND name = v_storage_object_name
  ) THEN
    RAISE EXCEPTION 'The uploaded product image was not found in Supabase Storage'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_product -> 'theme_config') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Product theme settings must be an object'
      USING ERRCODE = '22023';
  END IF;
  v_theme_config := p_product -> 'theme_config';
  v_is_active := coalesce((p_product ->> 'is_active')::boolean, false);
  v_is_featured := coalesce((p_product ->> 'is_featured')::boolean, false);

  IF coalesce(p_product ->> 'display_order', '0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Display order must be a whole number of 0 or greater'
      USING ERRCODE = '22023';
  END IF;
  v_display_order := coalesce((p_product ->> 'display_order')::integer, 0);

  FOREACH v_notes IN ARRAY ARRAY[
    coalesce(p_product -> 'top_notes', '[]'::jsonb),
    coalesce(p_product -> 'heart_notes', '[]'::jsonb),
    coalesce(p_product -> 'base_notes', '[]'::jsonb)
  ]
  LOOP
    IF jsonb_typeof(v_notes) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Fragrance notes must be lists of text'
        USING ERRCODE = '22023';
    END IF;
    FOR v_note IN SELECT value FROM jsonb_array_elements(v_notes) AS item(value)
    LOOP
      IF jsonb_typeof(v_note) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Fragrance notes must be lists of text'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.products (
    name, slug, brand, description, fragrance_family, gender, concentration,
    top_notes, heart_notes, base_notes, mood, occasion, season, image_url,
    theme_config, is_active, is_featured, display_order
  )
  VALUES (
    v_name,
    v_slug,
    v_brand,
    v_description,
    nullif(btrim(p_product ->> 'fragrance_family'), ''),
    v_gender,
    nullif(btrim(p_product ->> 'concentration'), ''),
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_product -> 'top_notes', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_product -> 'heart_notes', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_product -> 'base_notes', '[]'::jsonb))),
    nullif(btrim(p_product ->> 'mood'), ''),
    nullif(btrim(p_product ->> 'occasion'), ''),
    nullif(btrim(p_product ->> 'season'), ''),
    v_image_url,
    v_theme_config,
    v_is_active,
    v_is_featured,
    v_display_order
  )
  RETURNING id INTO v_product_id;

  FOR v_variant IN
    SELECT value FROM jsonb_array_elements(p_variants) AS item(value)
  LOOP
    IF jsonb_typeof(v_variant) IS DISTINCT FROM 'object'
       OR v_variant ? 'id'
       OR v_variant ? 'product_id' THEN
      RAISE EXCEPTION 'New variant rows cannot supply existing IDs or product links'
        USING ERRCODE = '22023';
    END IF;

    v_variant_type := coalesce(nullif(v_variant ->> 'variant_type', ''), 'decant');
    v_size_text := v_variant ->> 'size_ml';
    IF v_size_text IS NULL OR v_size_text !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Variant volume must be a whole number of millilitres'
        USING ERRCODE = '22023';
    END IF;
    v_size_ml := v_size_text::integer;

    IF v_variant_type = 'decant' THEN
      IF v_size_ml = 5 THEN
        IF v_has_5ml THEN
          RAISE EXCEPTION 'Only one 5 ml decant may be created per perfume'
            USING ERRCODE = '22023';
        END IF;
        v_has_5ml := true;
      ELSIF v_size_ml = 10 THEN
        IF v_has_10ml THEN
          RAISE EXCEPTION 'Only one 10 ml decant may be created per perfume'
            USING ERRCODE = '22023';
        END IF;
        v_has_10ml := true;
      ELSE
        RAISE EXCEPTION 'Decant sizes must be 5 ml or 10 ml'
          USING ERRCODE = '22023';
      END IF;
    ELSIF v_variant_type = 'full_bottle' THEN
      IF v_has_full_bottle OR v_size_ml < 1 THEN
        RAISE EXCEPTION 'A full bottle needs one verified positive volume'
          USING ERRCODE = '22023';
      END IF;
      v_has_full_bottle := true;
    ELSE
      RAISE EXCEPTION 'Unsupported product format'
        USING ERRCODE = '22023';
    END IF;

    v_sku := nullif(btrim(v_variant ->> 'sku'), '');
    IF v_sku IS NULL THEN
      v_sku := CASE
        WHEN v_variant_type = 'full_bottle'
          THEN v_slug || '-full-bottle-' || v_size_ml::text || 'ml'
        ELSE v_slug || '-' || v_size_ml::text || 'ml'
      END;
    END IF;

    v_price_needs_configuration :=
      coalesce((v_variant ->> 'price_needs_configuration')::boolean, true);
    v_price_lkr := NULL;
    IF NOT v_price_needs_configuration THEN
      v_price_text := v_variant ->> 'price_lkr';
      IF v_price_text IS NULL OR v_price_text !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
        RAISE EXCEPTION 'Enter a nonnegative price with no more than two decimal places'
          USING ERRCODE = '22023';
      END IF;
      v_price_lkr := v_price_text::numeric(12, 2);
    END IF;

    v_stock_needs_configuration :=
      coalesce((v_variant ->> 'stock_needs_configuration')::boolean, true);
    v_stock_quantity := 0;
    IF NOT v_stock_needs_configuration THEN
      v_stock_text := v_variant ->> 'stock_quantity';
      IF v_stock_text IS NULL OR v_stock_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Stock must be a whole number of 0 or greater'
          USING ERRCODE = '22023';
      END IF;
      v_stock_quantity := v_stock_text::integer;
    END IF;

    v_threshold_text := nullif(v_variant ->> 'low_stock_threshold', '');
    v_low_stock_threshold := NULL;
    IF v_threshold_text IS NOT NULL THEN
      IF v_threshold_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Low-stock thresholds must be whole numbers of 0 or greater'
          USING ERRCODE = '22023';
      END IF;
      v_low_stock_threshold := v_threshold_text::integer;
    END IF;

    v_variant_is_active := coalesce((v_variant ->> 'is_active')::boolean, false);
    IF v_variant_is_active
       AND NOT v_price_needs_configuration
       AND NOT v_stock_needs_configuration THEN
      v_has_publishable_variant := true;
    END IF;

    INSERT INTO public.product_variants (
      product_id, variant_type, size_ml, sku, price_lkr,
      price_needs_configuration, stock_quantity, stock_needs_configuration,
      low_stock_threshold, is_active
    )
    VALUES (
      v_product_id, v_variant_type, v_size_ml, v_sku, v_price_lkr,
      v_price_needs_configuration, v_stock_quantity, v_stock_needs_configuration,
      v_low_stock_threshold, v_variant_is_active
    );
  END LOOP;

  IF NOT v_has_5ml OR NOT v_has_10ml THEN
    RAISE EXCEPTION 'Every perfume needs both 5 ml and 10 ml decant variants'
      USING ERRCODE = '22023';
  END IF;
  IF v_is_active AND NOT v_has_publishable_variant THEN
    RAISE EXCEPTION 'Configure price and stock for at least one active format before publishing'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_product_id;
END
$product_creation$;

REVOKE ALL ON FUNCTION public.nidor_create_product_with_variants(jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nidor_create_product_with_variants(jsonb, jsonb)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
