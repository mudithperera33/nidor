import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type CartLine = { variantId: string; quantity: number };
export type LegacyCartLine = { slug: string; sizeMl: 5 | 10; quantity: number };
type CartContextValue = {
  lines: CartLine[];
  legacyLines: LegacyCartLine[];
  migrationNotice: string;
  setQuantity: (variantId: string, quantity: number) => void;
  add: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  migrateLegacy: (resolved: CartLine[], unresolvedCount: number) => void;
  count: number;
};

const STORAGE_KEY = 'nidor-cart-v2';
const LEGACY_STORAGE_KEY = 'nidor-cart-v1';
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const CartContext = createContext<CartContextValue | null>(null);

function isValidQuantity(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 99;
}

export function setCartLineQuantity(lines: CartLine[], variantId: string, quantity: number): CartLine[] {
  if (!UUID_PATTERN.test(variantId)) return lines;
  const next = lines.filter((line) => line.variantId !== variantId);
  if (isValidQuantity(quantity)) next.push({ variantId, quantity });
  return next;
}

function readStoredCart(): { lines: CartLine[]; legacyLines: LegacyCartLine[] } {
  try {
    const storedLines: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const storedLegacyLines: unknown = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]');
    const lines = Array.isArray(storedLines)
      ? storedLines.filter((line): line is CartLine =>
        line && typeof line.variantId === 'string' && UUID_PATTERN.test(line.variantId)
        && isValidQuantity(line.quantity),
      )
      : [];
    const legacyLines = Array.isArray(storedLegacyLines)
      ? storedLegacyLines.filter((line): line is LegacyCartLine =>
        line && typeof line.slug === 'string' && (line.sizeMl === 5 || line.sizeMl === 10)
        && isValidQuantity(line.quantity),
      )
      : [];
    return { lines, legacyLines };
  } catch {
    return { lines: [], legacyLines: [] };
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [legacyLines, setLegacyLines] = useState<LegacyCartLine[]>([]);
  const [migrationNotice, setMigrationNotice] = useState('');

  useEffect(() => {
    const stored = readStoredCart();
    setLines(stored.lines);
    setLegacyLines(stored.legacyLines);
    const sync = () => {
      const next = readStoredCart();
      setLines(next.lines);
      setLegacyLines(next.legacyLines);
    };
    window.addEventListener('storage', sync);
    window.addEventListener('nidor-cart-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('nidor-cart-change', sync);
    };
  }, []);

  const commit = useCallback((next: CartLine[]) => {
    setLines(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('nidor-cart-change'));
  }, []);

  const setQuantity = useCallback((variantId: string, quantity: number) => {
    commit(setCartLineQuantity(lines, variantId, quantity));
  }, [commit, lines]);

  const add = useCallback((variantId: string, quantity: number) => {
    if (!isValidQuantity(quantity)) return;
    const existing = lines.find((line) => line.variantId === variantId);
    setQuantity(variantId, Math.min(99, (existing?.quantity ?? 0) + quantity));
  }, [lines, setQuantity]);

  const remove = useCallback((variantId: string) => setQuantity(variantId, 0), [setQuantity]);

  const clear = useCallback(() => {
    setLines([]);
    setLegacyLines([]);
    setMigrationNotice('');
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    window.dispatchEvent(new Event('nidor-cart-change'));
  }, []);

  const migrateLegacy = useCallback((resolved: CartLine[], unresolvedCount: number) => {
    const combined = new Map(lines.map((line) => [line.variantId, line.quantity]));
    for (const line of resolved) {
      combined.set(line.variantId, Math.min(99, (combined.get(line.variantId) ?? 0) + line.quantity));
    }
    const next = [...combined].map(([variantId, quantity]) => ({ variantId, quantity }));
    commit(next);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setLegacyLines([]);
    setMigrationNotice(unresolvedCount > 0
      ? `${unresolvedCount} saved ${unresolvedCount === 1 ? 'item was' : 'items were'} no longer active and could not be restored.`
      : '');
  }, [commit, lines]);

  const value = useMemo(() => ({
    lines,
    legacyLines,
    migrationNotice,
    setQuantity,
    add,
    remove,
    clear,
    migrateLegacy,
    count: lines.reduce((sum, line) => sum + line.quantity, 0)
      + legacyLines.reduce((sum, line) => sum + line.quantity, 0),
  }), [lines, legacyLines, migrationNotice, setQuantity, add, remove, clear, migrateLegacy]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used within CartProvider');
  return value;
}
