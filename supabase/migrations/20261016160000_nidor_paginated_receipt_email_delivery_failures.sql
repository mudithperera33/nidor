BEGIN;

CREATE INDEX IF NOT EXISTS nidor_receipt_email_delivery_failures_page_idx
  ON public.nidor_order_receipt_email_retries (updated_at DESC, order_id ASC)
  WHERE status IN ('bounced', 'complained');

-- Keep existing clients bounded during rollout while the admin UI moves to cursors.
CREATE OR REPLACE FUNCTION public.nidor_list_receipt_email_delivery_failures()
RETURNS TABLE (
  order_id uuid,
  delivery_status text,
  event_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
BEGIN
  IF NOT public.nidor_is_product_admin() THEN
    RAISE EXCEPTION 'Product admin access is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT retries.order_id, retries.status, retries.updated_at
    FROM public.nidor_order_receipt_email_retries AS retries
   WHERE retries.status IN ('bounced', 'complained')
   ORDER BY retries.updated_at DESC, retries.order_id ASC
   LIMIT 25;
END
$function$;

CREATE OR REPLACE FUNCTION public.nidor_list_receipt_email_delivery_failures(
  p_page_size integer,
  p_after_event_at timestamptz,
  p_after_order_id uuid
)
RETURNS TABLE (
  order_id uuid,
  delivery_status text,
  event_at timestamptz,
  has_more boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
BEGIN
  IF NOT public.nidor_is_product_admin() THEN
    RAISE EXCEPTION 'Product admin access is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'Receipt delivery page size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;
  IF (p_after_event_at IS NULL) <> (p_after_order_id IS NULL) THEN
    RAISE EXCEPTION 'Both receipt delivery cursor fields must be provided together'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH selected AS MATERIALIZED (
    SELECT retries.order_id, retries.status, retries.updated_at
      FROM public.nidor_order_receipt_email_retries AS retries
     WHERE retries.status IN ('bounced', 'complained')
       AND (
         p_after_event_at IS NULL
         OR retries.updated_at < p_after_event_at
         OR (retries.updated_at = p_after_event_at AND retries.order_id > p_after_order_id)
       )
     ORDER BY retries.updated_at DESC, retries.order_id ASC
     LIMIT p_page_size + 1
  ),
  ranked AS (
    SELECT selected.order_id,
           selected.status,
           selected.updated_at,
           row_number() OVER (ORDER BY selected.updated_at DESC, selected.order_id ASC) AS row_num
      FROM selected
  )
  SELECT ranked.order_id,
         ranked.status,
         ranked.updated_at,
         (SELECT count(*) > p_page_size FROM selected) AS has_more
    FROM ranked
   WHERE ranked.row_num <= p_page_size
   ORDER BY ranked.updated_at DESC, ranked.order_id ASC;
END
$function$;

REVOKE ALL ON FUNCTION public.nidor_list_receipt_email_delivery_failures()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nidor_list_receipt_email_delivery_failures(integer, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nidor_list_receipt_email_delivery_failures()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nidor_list_receipt_email_delivery_failures(integer, timestamptz, uuid)
  TO authenticated;

COMMIT;
