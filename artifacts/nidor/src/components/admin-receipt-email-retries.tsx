import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, LoaderCircle, MailWarning, RefreshCw, RotateCcw } from 'lucide-react';
import {
  fetchExhaustedReceiptEmailRetries,
  fetchReceiptEmailDeliveryFailures,
  restartExhaustedReceiptEmailRetry,
  type ExhaustedReceiptEmailRetry,
  type ReceiptEmailDeliveryFailure,
} from '@/lib/admin-receipt-retries';

function displayDate(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
}

export default function AdminReceiptEmailRetries() {
  const [rows, setRows] = useState<ExhaustedReceiptEmailRetry[]>([]);
  const [deliveryFailures, setDeliveryFailures] = useState<ReceiptEmailDeliveryFailure[]>([]);
  const [hasMoreDeliveryFailures, setHasMoreDeliveryFailures] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadRetries = useCallback(async (quiet = false) => {
    if (quiet) setIsRefreshing(true);
    else setIsLoading(true);
    setError('');
    try {
      const [retryRows, failurePage] = await Promise.all([
        fetchExhaustedReceiptEmailRetries(),
        fetchReceiptEmailDeliveryFailures({ pageSize: 25 }),
      ]);
      setRows(retryRows);
      setDeliveryFailures(failurePage.items);
      setHasMoreDeliveryFailures(failurePage.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load failed receipt emails.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const refreshRetriesOnly = useCallback(async () => {
    try {
      setRows(await fetchExhaustedReceiptEmailRetries());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not refresh exhausted receipt emails.');
    }
  }, []);

  useEffect(() => {
    void loadRetries();
    const timer = window.setInterval(() => void refreshRetriesOnly(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadRetries, refreshRetriesOnly]);

  const retryOrder = async (row: ExhaustedReceiptEmailRetry) => {
    if (!window.confirm(`Start a new bounded receipt-email retry cycle for order …${row.order_id.slice(-8)}?`)) return;
    setBusyOrderId(row.order_id);
    setError('');
    setNotice('');
    try {
      const restarted = await restartExhaustedReceiptEmailRetry(row.order_id);
      if (!restarted) {
        setError('This receipt is no longer exhausted. Refresh the list and try again.');
        await loadRetries(true);
        return;
      }
      setNotice(`A new retry cycle has been queued for order …${row.order_id.slice(-8)}.`);
      await loadRetries(true);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Could not restart this receipt email.');
    } finally {
      setBusyOrderId('');
    }
  };

  const loadOlderDeliveryFailures = async () => {
    const last = deliveryFailures.at(-1);
    if (!last || !hasMoreDeliveryFailures || isLoadingOlder) return;
    setIsLoadingOlder(true);
    setError('');
    try {
      const page = await fetchReceiptEmailDeliveryFailures({
        pageSize: 25,
        cursor: { eventAt: last.event_at, orderId: last.order_id },
      });
      setDeliveryFailures((current) => {
        const existingIds = new Set(current.map((failure) => failure.order_id));
        return [...current, ...page.items.filter((failure) => !existingIds.has(failure.order_id))];
      });
      setHasMoreDeliveryFailures(page.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load older delivery failures.');
    } finally {
      setIsLoadingOlder(false);
    }
  };

  return (
    <section className="na-receipt-retries" aria-labelledby="na-receipt-retries-title">
      <div className="na-heading-row">
        <div>
          <div className="na-eyebrow"><span /> NIDOR / CUSTOMER OPERATIONS</div>
          <h1 id="na-receipt-retries-title">Receipt emails<span>.</span></h1>
          <p className="na-intro">Review receipts that reached the retry limit. Restarting sends the saved receipt only; it never creates an order or changes stock.</p>
        </div>
        <button
          type="button"
          className="na-secondary-button"
          onClick={() => void loadRetries(true)}
          disabled={isRefreshing || isLoading || isLoadingOlder}
          data-testid="button-refresh-receipt-retries"
        >
          {isRefreshing ? <LoaderCircle className="na-spin" size={15} /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </div>

      {error && <div className="na-state na-error" role="alert" data-testid="status-receipt-retry-error"><AlertCircle size={20} /><div><strong>Receipt list unavailable</strong><p>{error}</p></div></div>}
      {notice && <div className="na-toast" role="status" data-testid="status-receipt-retry-notice">{notice}</div>}

      {isLoading ? (
        <div className="na-state" role="status"><LoaderCircle className="na-spin" size={20} /> Loading receipt emails…</div>
      ) : rows.length === 0 && deliveryFailures.length === 0 && !error ? (
        <div className="na-state na-empty" data-testid="empty-receipt-retries"><div className="na-empty-mark"><MailWarning size={22} /></div><strong>No receipt email issues</strong><p>Automatic retries and provider delivery events will appear here if a receipt needs attention.</p></div>
      ) : null}

      {!isLoading && rows.length > 0 ? (
        <div className="na-table-wrap">
          <table className="na-table na-receipt-table">
            <thead><tr><th scope="col">Order reference</th><th scope="col">Order saved</th><th scope="col">Attempts</th><th scope="col">Last error</th><th scope="col">Last attempt</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.order_id} data-testid={`row-exhausted-receipt-${row.order_id}`}>
                  <td><strong>…{row.order_id.slice(-8)}</strong></td>
                  <td>{displayDate(row.order_created_at)}</td>
                  <td>{row.attempt_count} / 5</td>
                  <td><code>{row.last_error_code || 'Unknown'}</code></td>
                  <td>{displayDate(row.last_attempt_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="na-retry-button"
                      onClick={() => void retryOrder(row)}
                      disabled={Boolean(busyOrderId)}
                      data-testid={`button-retry-receipt-${row.order_id}`}
                    >
                      {busyOrderId === row.order_id ? <LoaderCircle className="na-spin" size={15} /> : <RotateCcw size={15} />}
                      Retry email
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="na-table-foot"><span>{rows.length} exhausted receipt{rows.length === 1 ? '' : 's'}</span><span>ORDER AND STOCK DATA ARE READ-ONLY</span></div>
        </div>
      ) : null}

      {!isLoading && (deliveryFailures.length > 0 || rows.length > 0) && (
        <section className="na-delivery-failures" aria-labelledby="na-delivery-failures-title" data-testid="receipt-delivery-failures">
          <div className="na-delivery-heading">
            <h2 id="na-delivery-failures-title">Delivery failures</h2>
            <p>Receipt emails that the provider later reported as bounced or marked as spam.</p>
          </div>
          {deliveryFailures.length > 0 ? (
            <div className="na-table-wrap">
              <table className="na-table na-delivery-table">
                <thead><tr><th scope="col">Order reference</th><th scope="col">Delivery status</th><th scope="col">Event time</th></tr></thead>
                <tbody>
                  {deliveryFailures.map((failure) => (
                    <tr key={failure.order_id} data-testid={`row-delivery-failure-${failure.order_id}`}>
                      <td><strong>…{failure.order_id.slice(-8)}</strong></td>
                      <td>{failure.delivery_status === 'bounced' ? 'Bounced' : 'Marked as spam'}</td>
                      <td>{displayDate(failure.event_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="na-table-foot"><span>{deliveryFailures.length} delivery failure{deliveryFailures.length === 1 ? '' : 's'} shown</span><span>NO CUSTOMER OR PROVIDER DETAILS SHOWN</span></div>
            </div>
          ) : !error ? (
            <div className="na-state na-empty" data-testid="empty-receipt-delivery-failures">No bounce or complaint events recorded.</div>
          ) : null}
          {hasMoreDeliveryFailures && deliveryFailures.length > 0 && (
            <button
              type="button"
              className="na-secondary-button na-load-older"
              onClick={() => void loadOlderDeliveryFailures()}
              disabled={isLoadingOlder}
              data-testid="button-load-older-delivery-failures"
            >
              {isLoadingOlder && <LoaderCircle className="na-spin" size={15} />}
              {isLoadingOlder ? 'Loading older events…' : 'Load older events'}
            </button>
          )}
        </section>
      )}
    </section>
  );
}
