import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabase';

export type ExhaustedReceiptEmailRetry = {
  order_id: string;
  attempt_count: number;
  last_attempt_at: string | null;
  last_error_code: string | null;
  order_created_at: string;
};

export type ReceiptEmailDeliveryFailure = {
  order_id: string;
  delivery_status: 'bounced' | 'complained';
  event_at: string;
};

export type ReceiptEmailDeliveryCursor = {
  eventAt: string;
  orderId: string;
};

export type ReceiptEmailDeliveryPage = {
  items: ReceiptEmailDeliveryFailure[];
  hasMore: boolean;
  nextCursor: ReceiptEmailDeliveryCursor | null;
};

const MIN_DELIVERY_PAGE_SIZE = 1;
const MAX_DELIVERY_PAGE_SIZE = 100;

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function parseRetryRows(data: unknown): ExhaustedReceiptEmailRetry[] {
  if (!Array.isArray(data)) throw new Error('The receipt retry list response was invalid.');
  return data.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('The receipt retry list response was invalid.');
    }
    const row = item as Record<string, unknown>;
    const attempts = Number(row.attempt_count);
    if (
      typeof row.order_id !== 'string'
      || !Number.isInteger(attempts)
      || attempts < 1
      || attempts > 5
      || (row.last_attempt_at !== null && typeof row.last_attempt_at !== 'string')
      || (row.last_error_code !== null && typeof row.last_error_code !== 'string')
      || typeof row.order_created_at !== 'string'
    ) {
      throw new Error('The receipt retry list response was invalid.');
    }
    return {
      order_id: row.order_id,
      attempt_count: attempts,
      last_attempt_at: row.last_attempt_at as string | null,
      last_error_code: row.last_error_code as string | null,
      order_created_at: row.order_created_at,
    };
  });
}

function parseDeliveryFailures(data: unknown, pageSize: number): ReceiptEmailDeliveryPage {
  if (!Array.isArray(data)) throw new Error('The receipt delivery list response was invalid.');
  let hasMore: boolean | undefined;
  const items = data.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('The receipt delivery list response was invalid.');
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.order_id !== 'string'
      || (row.delivery_status !== 'bounced' && row.delivery_status !== 'complained')
      || typeof row.event_at !== 'string'
      || Number.isNaN(new Date(row.event_at).getTime())
      || typeof row.has_more !== 'boolean'
    ) {
      throw new Error('The receipt delivery list response was invalid.');
    }
    if (hasMore !== undefined && hasMore !== row.has_more) {
      throw new Error('The receipt delivery list response was inconsistent.');
    }
    hasMore = row.has_more;
    return {
      order_id: row.order_id,
      delivery_status: row.delivery_status as ReceiptEmailDeliveryFailure['delivery_status'],
      event_at: row.event_at,
    };
  });
  if (items.length > pageSize) throw new Error('The receipt delivery list response exceeded its page size.');
  const more = hasMore ?? false;
  const last = items.at(-1);
  return {
    items,
    hasMore: more,
    nextCursor: more && last ? { eventAt: last.event_at, orderId: last.order_id } : null,
  };
}

export async function fetchExhaustedReceiptEmailRetries(
  client: SupabaseClient = getSupabaseClient(),
): Promise<ExhaustedReceiptEmailRetry[]> {
  const { data, error } = await client.rpc('nidor_list_exhausted_receipt_email_retries');
  throwIfError(error);
  return parseRetryRows(data);
}

export async function fetchReceiptEmailDeliveryFailures(
  options: {
    pageSize?: number;
    cursor?: ReceiptEmailDeliveryCursor | null;
  } = {},
  client: SupabaseClient = getSupabaseClient(),
): Promise<ReceiptEmailDeliveryPage> {
  const pageSize = options.pageSize ?? 25;
  const cursor = options.cursor ?? null;
  if (!Number.isInteger(pageSize) || pageSize < MIN_DELIVERY_PAGE_SIZE || pageSize > MAX_DELIVERY_PAGE_SIZE) {
    throw new Error(`Choose a page size between ${MIN_DELIVERY_PAGE_SIZE} and ${MAX_DELIVERY_PAGE_SIZE}.`);
  }
  if (cursor && (
    Number.isNaN(new Date(cursor.eventAt).getTime())
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.orderId)
  )) {
    throw new Error('The receipt delivery cursor was invalid.');
  }
  const { data, error } = await client.rpc('nidor_list_receipt_email_delivery_failures', {
    p_page_size: pageSize,
    p_after_event_at: cursor?.eventAt ?? null,
    p_after_order_id: cursor?.orderId ?? null,
  });
  throwIfError(error);
  return parseDeliveryFailures(data, pageSize);
}

export async function restartExhaustedReceiptEmailRetry(
  orderId: string,
  client: SupabaseClient = getSupabaseClient(),
): Promise<boolean> {
  const { data, error } = await client.rpc(
    'nidor_restart_exhausted_receipt_email_retry',
    { p_order_id: orderId },
  );
  throwIfError(error);
  if (typeof data !== 'boolean') throw new Error('The receipt retry response was invalid.');
  return data;
}
