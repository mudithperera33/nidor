import { useCallback, useEffect, useState } from 'react';
import { validateCart, type CartValidationRequest, type CartValidationResponse } from '@workspace/api-client-react';
import type { CartLine } from '@/hooks/use-cart';

export function useCartValidation(lines: CartLine[]) {
  const requestLines: CartValidationRequest['lines'] = lines.map(({ variantId, quantity }) => ({ variantId, quantity }));
  const signature = JSON.stringify(requestLines);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestKey = `${signature}:${refreshVersion}`;
  const [result, setResult] = useState<{ requestKey: string; data: CartValidationResponse } | null>(null);
  const [failure, setFailure] = useState<{ requestKey: string; message: string } | null>(null);
  const refresh = useCallback(() => setRefreshVersion((current) => current + 1), []);

  useEffect(() => {
    if (requestLines.length === 0) {
      setResult({ requestKey, data: { lines: [] } });
      setFailure(null);
      return;
    }

    let current = true;
    setResult(null);
    setFailure(null);
    validateCart({ lines: requestLines })
      .then((data) => {
        if (current) setResult({ requestKey, data });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setFailure({
          requestKey,
          message: error instanceof Error
            ? error.message
            : 'Current prices and availability could not be verified.',
        });
      });

    return () => {
      current = false;
    };
  }, [requestKey]);

  const currentData = result?.requestKey === requestKey ? result.data : null;
  const currentError = failure?.requestKey === requestKey ? failure.message : null;
  return {
    data: currentData,
    error: currentError,
    isLoading: lines.length > 0 && currentData === null && currentError === null,
    refresh,
  };
}
