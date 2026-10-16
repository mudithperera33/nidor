import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchExhaustedReceiptEmailRetries,
  fetchReceiptEmailDeliveryFailures,
  restartExhaustedReceiptEmailRetry,
} from './admin-receipt-retries';

const orderId = 'd6e0d9cc-9236-4993-a144-c2815a11d335';

function rpcClient(
  response: { data: unknown; error: { message: string } | null },
  call: (name: string, args?: Record<string, unknown>) => void,
): SupabaseClient {
  return {
    rpc(name: string, args?: Record<string, unknown>) {
      call(name, args);
      return Promise.resolve(response);
    },
  } as unknown as SupabaseClient;
}

test('exhausted receipt list uses the admin RPC and returns only order delivery metadata', async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client = rpcClient({
    data: [{
      order_id: orderId,
      attempt_count: 5,
      last_attempt_at: '2026-10-14T10:00:00Z',
      last_error_code: 'resend_rejected',
      order_created_at: '2026-10-14T09:00:00Z',
    }],
    error: null,
  }, (name, args) => calls.push({ name, args }));

  const rows = await fetchExhaustedReceiptEmailRetries(client);

  assert.deepEqual(calls, [{ name: 'nidor_list_exhausted_receipt_email_retries', args: undefined }]);
  assert.deepEqual(rows, [{
    order_id: orderId,
    attempt_count: 5,
    last_attempt_at: '2026-10-14T10:00:00Z',
    last_error_code: 'resend_rejected',
    order_created_at: '2026-10-14T09:00:00Z',
  }]);
  assert.equal('customer_email' in rows[0]!, false);
});

test('restart invokes the admin RPC for the selected order and returns its boolean result', async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client = rpcClient({ data: true, error: null }, (name, args) => calls.push({ name, args }));

  assert.equal(await restartExhaustedReceiptEmailRetry(orderId, client), true);
  assert.deepEqual(calls, [{
    name: 'nidor_restart_exhausted_receipt_email_retry',
    args: { p_order_id: orderId },
  }]);
});

test('invalid receipt retry response fails explicitly', async () => {
  const client = rpcClient({ data: [{ order_id: orderId }], error: null }, () => {});
  await assert.rejects(fetchExhaustedReceiptEmailRetries(client), /response was invalid/i);
});

test('delivery failure list uses the admin RPC and exposes only order, state, and event time', async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client = rpcClient({
    data: [{
      order_id: orderId,
      delivery_status: 'bounced',
      event_at: '2026-10-16T10:15:00Z',
      has_more: false,
    }],
    error: null,
  }, (name, args) => calls.push({ name, args }));

  const page = await fetchReceiptEmailDeliveryFailures({}, client);

  assert.deepEqual(calls, [{
    name: 'nidor_list_receipt_email_delivery_failures',
    args: { p_page_size: 25, p_after_event_at: null, p_after_order_id: null },
  }]);
  assert.deepEqual(page, {
    items: [{
      order_id: orderId,
      delivery_status: 'bounced',
      event_at: '2026-10-16T10:15:00Z',
    }],
    hasMore: false,
    nextCursor: null,
  });
  assert.equal('customer_email' in page.items[0]!, false);
  assert.equal('provider_email_id' in page.items[0]!, false);
});

test('invalid delivery failure response is rejected', async () => {
  const client = rpcClient({
    data: [{ order_id: orderId, delivery_status: 'sent', event_at: 'not-a-date', has_more: false }],
    error: null,
  }, () => {});
  await assert.rejects(fetchReceiptEmailDeliveryFailures({}, client), /response was invalid/i);
});

test('delivery failure pages use a bounded size, deterministic cursor, and expose a next cursor', async () => {
  const nextOrderId = 'b6e0d9cc-9236-4993-a144-c2815a11d335';
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client = rpcClient({
    data: [{
      order_id: nextOrderId,
      delivery_status: 'complained',
      event_at: '2026-10-15T08:30:00Z',
      has_more: true,
      customer_email: 'private@example.com',
      provider_email_id: 'private-provider-id',
    }],
    error: null,
  }, (name, args) => calls.push({ name, args }));

  const page = await fetchReceiptEmailDeliveryFailures({
    pageSize: 1,
    cursor: { eventAt: '2026-10-16T10:15:00Z', orderId },
  }, client);

  assert.deepEqual(calls, [{
    name: 'nidor_list_receipt_email_delivery_failures',
    args: {
      p_page_size: 1,
      p_after_event_at: '2026-10-16T10:15:00Z',
      p_after_order_id: orderId,
    },
  }]);
  assert.deepEqual(page, {
    items: [{
      order_id: nextOrderId,
      delivery_status: 'complained',
      event_at: '2026-10-15T08:30:00Z',
    }],
    hasMore: true,
    nextCursor: { eventAt: '2026-10-15T08:30:00Z', orderId: nextOrderId },
  });
  assert.doesNotMatch(JSON.stringify(page), /private@example\.com|private-provider-id/);
});

test('invalid pagination values are rejected before the RPC is called', async () => {
  let called = false;
  const client = rpcClient({ data: [], error: null }, () => {
    called = true;
  });
  await assert.rejects(fetchReceiptEmailDeliveryFailures({ pageSize: 101 }, client), /page size between 1 and 100/i);
  await assert.rejects(fetchReceiptEmailDeliveryFailures({
    cursor: { eventAt: '2026-10-16T10:15:00Z', orderId: 'not-a-uuid' },
  }, client), /cursor was invalid/i);
  assert.equal(called, false);
});
