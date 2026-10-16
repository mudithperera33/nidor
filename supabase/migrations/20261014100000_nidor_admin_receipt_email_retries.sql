BEGIN;

ALTER TABLE public.nidor_order_receipt_email_retries
  DROP CONSTRAINT IF EXISTS nidor_order_receipt_email_retries_attempt_count_check;
ALTER TABLE public.nidor_order_receipt_email_retries
  ADD CONSTRAINT nidor_order_receipt_email_retries_attempt_count_check
  CHECK (attempt_count BETWEEN 0 AND 5);

CREATE OR REPLACE FUNCTION public.nidor_list_exhausted_receipt_email_retries()
RETURNS TABLE (
  order_id uuid,
  attempt_count smallint,
  last_attempt_at timestamptz,
  last_error_code text,
  order_created_at timestamptz
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
  SELECT retries.order_id, retries.attempt_count, retries.last_attempt_at,
         retries.last_error_code, orders.created_at
    FROM public.nidor_order_receipt_email_retries AS retries
    JOIN public.nidor_orders AS orders ON orders.id = retries.order_id
   WHERE retries.status = 'exhausted'
   ORDER BY retries.updated_at DESC, retries.order_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.nidor_restart_exhausted_receipt_email_retry(
  p_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
BEGIN
  IF NOT public.nidor_is_product_admin() THEN
    RAISE EXCEPTION 'Product admin access is required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.nidor_order_receipt_email_retries
     SET status = 'pending',
         attempt_count = 0,
         next_attempt_at = statement_timestamp() + INTERVAL '1 minute',
         last_attempt_at = NULL,
         lease_expires_at = NULL,
         accepted_at = NULL,
         last_error_code = NULL,
         updated_at = statement_timestamp()
   WHERE order_id = p_order_id
     AND status = 'exhausted';

  RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION public.nidor_list_exhausted_receipt_email_retries()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nidor_restart_exhausted_receipt_email_retry(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nidor_list_exhausted_receipt_email_retries()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nidor_restart_exhausted_receipt_email_retry(uuid)
  TO authenticated;

COMMIT;
