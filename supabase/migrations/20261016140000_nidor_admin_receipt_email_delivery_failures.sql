BEGIN;

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
   ORDER BY retries.updated_at DESC, retries.order_id;
END
$function$;

REVOKE ALL ON FUNCTION public.nidor_list_receipt_email_delivery_failures()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nidor_list_receipt_email_delivery_failures()
  TO authenticated;

COMMIT;
