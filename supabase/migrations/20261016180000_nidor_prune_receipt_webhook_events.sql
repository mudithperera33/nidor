BEGIN;

CREATE INDEX IF NOT EXISTS nidor_receipt_email_webhook_events_retention_idx
  ON public.nidor_receipt_email_webhook_events (received_at ASC, event_id ASC);

CREATE OR REPLACE FUNCTION public.nidor_prune_receipt_email_webhook_events(
  p_batch_size integer
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 500 THEN
    RAISE EXCEPTION 'Webhook event cleanup batch size must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  WITH expired AS MATERIALIZED (
    SELECT event_id
      FROM public.nidor_receipt_email_webhook_events
     WHERE received_at < statement_timestamp() - INTERVAL '30 days'
     ORDER BY received_at ASC, event_id ASC
     FOR UPDATE SKIP LOCKED
     LIMIT p_batch_size
  )
  DELETE FROM public.nidor_receipt_email_webhook_events AS events
   USING expired
   WHERE events.event_id = expired.event_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$function$;

REVOKE ALL ON FUNCTION public.nidor_prune_receipt_email_webhook_events(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nidor_prune_receipt_email_webhook_events(integer)
  TO service_role;

COMMIT;
