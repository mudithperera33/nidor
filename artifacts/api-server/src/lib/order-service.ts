import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getNidorDatabasePool } from "./nidor-database";

export type OrderSubmission = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryAddress: string;
  lines: Array<{ variantId: string; quantity: number }>;
};

export type OrderReceiptLookup = {
  orderId: string;
  customerEmail: string;
};

export type CreatedOrder = {
  orderId: string;
  status: "pending_payment";
  subtotalLkr: number;
  lines: Array<{
    variantId: string;
    productName: string;
    brand: string;
    variantType: "decant" | "full_bottle";
    sizeMl: number;
    quantity: number;
    unitPriceLkr: number;
    lineTotalLkr: number;
  }>;
};

export type OrderRejectionReason =
  | "unavailable"
  | "price_unconfigured"
  | "stock_unconfigured"
  | "out_of_stock"
  | "insufficient_stock"
  | "idempotency_conflict";

export type PlaceOrderResult =
  | { kind: "created"; order: CreatedOrder }
  | { kind: "replayed"; order: CreatedOrder }
  | { kind: "rejected"; reason: OrderRejectionReason }
  | { kind: "storage_unavailable" };

export type RecoverOrderReceiptResult =
  | { kind: "found"; receipt: CreatedOrder }
  | { kind: "not_found" }
  | { kind: "storage_unavailable" };

type LockedVariantRow = {
  variant_id: string;
  product_name: string;
  brand: string;
  product_is_active: boolean;
  variant_is_active: boolean;
  variant_type: string | null;
  size_ml: number;
  price_lkr: string | null;
  price_needs_configuration: boolean;
  stock_quantity: number;
  stock_needs_configuration: boolean;
};

type PersistedOrderLine = {
  variant_id: string;
  product_name: string;
  brand: string;
  variant_type: string;
  size_ml: number;
  quantity: number;
  unit_price_lkr: string;
  line_total_lkr: string;
};

type OrderHeaderRow = { order_id: string; subtotal_lkr: string };

type StoredOrderRow = {
  order_id: string;
  request_fingerprint: string;
  subtotal_lkr: string;
  variant_id: string | null;
  product_name: string | null;
  brand: string | null;
  variant_type: string | null;
  size_ml: number | null;
  quantity: number | null;
  unit_price_lkr: string | null;
  line_total_lkr: string | null;
};

function fingerprintOrder(input: OrderSubmission): string {
  const canonicalOrder = {
    customerName: input.customerName.trim(),
    customerEmail: input.customerEmail.trim().toLowerCase(),
    customerPhone: input.customerPhone.trim(),
    deliveryAddress: input.deliveryAddress.trim(),
    lines: input.lines
      .map((line) => ({ variantId: line.variantId.toLowerCase(), quantity: line.quantity }))
      .sort((left, right) => left.variantId.localeCompare(right.variantId)),
  };
  return createHash("sha256").update(JSON.stringify(canonicalOrder)).digest("hex");
}

async function findOrderByIdempotencyKey(
  client: PoolClient,
  idempotencyKey: string,
): Promise<StoredOrderRow[]> {
  const result = await client.query<StoredOrderRow>(
    `SELECT
       o.id::text AS order_id,
       o.idempotency_request_hash AS request_fingerprint,
       o.subtotal_lkr::text,
       oi.variant_id::text,
       oi.product_name_snapshot AS product_name,
       oi.brand_snapshot AS brand,
       oi.variant_type_snapshot AS variant_type,
       oi.size_ml_snapshot AS size_ml,
       oi.quantity,
       oi.unit_price_lkr::text,
       oi.line_total_lkr::text
     FROM public.nidor_orders AS o
     LEFT JOIN public.nidor_order_items AS oi ON oi.order_id = o.id
     WHERE o.idempotency_key = $1::uuid
     ORDER BY oi.created_at, oi.id`,
    [idempotencyKey],
  );
  return result.rows;
}

function resultForStoredOrder(
  rows: StoredOrderRow[],
  requestFingerprint: string,
): PlaceOrderResult {
  const order = rows[0];
  if (!order) throw new Error("Idempotent order lookup returned no receipt rows.");
  if (order.request_fingerprint !== requestFingerprint) {
    return { kind: "rejected", reason: "idempotency_conflict" };
  }

  return { kind: "replayed", order: receiptForStoredOrder(rows) };
}

function receiptForStoredOrder(rows: StoredOrderRow[]): CreatedOrder {
  const order = rows[0];
  if (!order) throw new Error("Stored order lookup returned no receipt rows.");
  return {
    orderId: order.order_id,
    status: "pending_payment",
    subtotalLkr: toLkrNumber(order.subtotal_lkr),
    lines: rows.map((line) => {
      if (
        line.variant_id === null
        || line.product_name === null
        || line.brand === null
        || line.variant_type === null
        || line.size_ml === null
        || line.quantity === null
        || line.unit_price_lkr === null
        || line.line_total_lkr === null
        || (line.variant_type !== "full_bottle" && line.variant_type !== "decant")
      ) {
        throw new Error("Stored order is missing valid receipt line details.");
      }
      return {
        variantId: line.variant_id,
        productName: line.product_name,
        brand: line.brand,
        variantType: line.variant_type,
        sizeMl: line.size_ml,
        quantity: line.quantity,
        unitPriceLkr: toLkrNumber(line.unit_price_lkr),
        lineTotalLkr: toLkrNumber(line.line_total_lkr),
      };
    }),
  };
}

function toMinorUnits(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return BigInt(match[1]) * 100n + BigInt(fraction || "0");
}

function fromMinorUnits(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

function toLkrNumber(value: string): number {
  return Number(value);
}

export function createOrderService(getPool: () => Pool | null) {
  return async function placeOrder(input: OrderSubmission, rawIdempotencyKey: string): Promise<PlaceOrderResult> {
    const pool = getPool();
    if (!pool) return { kind: "storage_unavailable" };
    if (
      input.lines.length === 0
      || new Set(input.lines.map((line) => line.variantId.toLowerCase())).size !== input.lines.length
    ) {
      return { kind: "rejected", reason: "unavailable" };
    }

    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const idempotencyKey = rawIdempotencyKey.toLowerCase();
      const requestFingerprint = fingerprintOrder(input);
      const existingOrder = await findOrderByIdempotencyKey(client, idempotencyKey);
      if (existingOrder.length > 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return resultForStoredOrder(existingOrder, requestFingerprint);
      }

      const requestedLines = input.lines.map((line) => ({
        ...line,
        variantId: line.variantId.toLowerCase(),
      }));
      const variantIds = requestedLines.map((line) => line.variantId);
      const { rows } = await client.query<LockedVariantRow>(
        `SELECT
           v.id::text AS variant_id,
           p.name AS product_name,
           p.brand,
           p.is_active AS product_is_active,
           v.is_active AS variant_is_active,
           to_jsonb(v)->>'variant_type' AS variant_type,
           v.size_ml,
           v.price_lkr::text AS price_lkr,
           v.price_needs_configuration,
           v.stock_quantity,
           v.stock_needs_configuration
         FROM public.product_variants AS v
         JOIN public.products AS p ON p.id = v.product_id
         WHERE v.id = ANY($1::uuid[])
         ORDER BY v.id
         FOR UPDATE OF v, p`,
        [variantIds],
      );

      // A matching request may have committed while this transaction waited for
      // the selected inventory rows. Return it before checking the now-lower stock.
      const orderAfterLock = await findOrderByIdempotencyKey(client, idempotencyKey);
      if (orderAfterLock.length > 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return resultForStoredOrder(orderAfterLock, requestFingerprint);
      }

      const byId = new Map(rows.map((row) => [row.variant_id, row]));
      if (byId.size !== requestedLines.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return { kind: "rejected", reason: "unavailable" };
      }

      let subtotalMinorUnits = 0n;
      const prices = new Map<string, bigint>();
      for (const line of requestedLines) {
        const row = byId.get(line.variantId);
        if (!row || !row.product_is_active || !row.variant_is_active) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return { kind: "rejected", reason: "unavailable" };
        }
        if (
          row.variant_type !== null
          && row.variant_type !== "decant"
          && row.variant_type !== "full_bottle"
        ) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return { kind: "rejected", reason: "unavailable" };
        }
        if (row.price_needs_configuration || row.price_lkr === null) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return { kind: "rejected", reason: "price_unconfigured" };
        }
        const unitPrice = toMinorUnits(row.price_lkr);
        if (unitPrice === null) {
          throw new Error("Catalog price could not be converted to minor currency units.");
        }
        if (row.stock_needs_configuration) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return { kind: "rejected", reason: "stock_unconfigured" };
        }
        if (row.stock_quantity <= 0) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return { kind: "rejected", reason: "out_of_stock" };
        }
        if (line.quantity > row.stock_quantity) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return { kind: "rejected", reason: "insufficient_stock" };
        }

        prices.set(line.variantId, unitPrice);
        subtotalMinorUnits += unitPrice * BigInt(line.quantity);
      }

      const subtotalLkr = fromMinorUnits(subtotalMinorUnits);
      const orderResult = await client.query<OrderHeaderRow>(
        `INSERT INTO public.nidor_orders (
           customer_name, customer_email, customer_phone, delivery_address,
           status, subtotal_lkr, idempotency_key, idempotency_request_hash
         )
         VALUES ($1, $2, $3, $4, 'pending_payment', $5::numeric, $6::uuid, $7)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id::text AS order_id, subtotal_lkr::text`,
        [
          input.customerName.trim(),
          input.customerEmail.trim().toLowerCase(),
          input.customerPhone.trim(),
          input.deliveryAddress.trim(),
          subtotalLkr,
          idempotencyKey,
          requestFingerprint,
        ],
      );
      const order = orderResult.rows[0];
      if (!order) {
        const winningOrder = await findOrderByIdempotencyKey(client, idempotencyKey);
        if (winningOrder.length === 0) {
          throw new Error("Conflicting order insert did not return the existing receipt.");
        }
        await client.query("ROLLBACK");
        transactionStarted = false;
        return resultForStoredOrder(winningOrder, requestFingerprint);
      }

      for (const line of requestedLines) {
        const updateResult = await client.query(
          `UPDATE public.product_variants
              SET stock_quantity = stock_quantity - $2
            WHERE id = $1::uuid
              AND is_active = true
              AND stock_needs_configuration = false
              AND stock_quantity >= $2`,
          [line.variantId, line.quantity],
        );
        if (updateResult.rowCount !== 1) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return { kind: "rejected", reason: "insufficient_stock" };
        }
      }

      const persistedLines = await client.query<PersistedOrderLine>(
        `INSERT INTO public.nidor_order_items (
           order_id, variant_id, product_name_snapshot, brand_snapshot,
           variant_type_snapshot, size_ml_snapshot, unit_price_lkr, quantity, line_total_lkr
         )
         SELECT
           $1::uuid,
           v.id,
           p.name,
           p.brand,
           COALESCE(to_jsonb(v)->>'variant_type', 'decant'),
           v.size_ml,
           v.price_lkr,
           requested.quantity,
           v.price_lkr * requested.quantity
         FROM unnest($2::uuid[], $3::integer[]) AS requested(variant_id, quantity)
         JOIN public.product_variants AS v ON v.id = requested.variant_id
         JOIN public.products AS p ON p.id = v.product_id
         RETURNING
           variant_id::text,
           product_name_snapshot AS product_name,
           brand_snapshot AS brand,
           variant_type_snapshot AS variant_type,
           size_ml_snapshot AS size_ml,
           quantity,
           unit_price_lkr::text,
           line_total_lkr::text`,
        [order.order_id, variantIds, requestedLines.map((line) => line.quantity)],
      );
      if (persistedLines.rowCount !== requestedLines.length) {
        throw new Error("Order line insert did not persist every requested variant.");
      }

      await client.query("COMMIT");
      transactionStarted = false;

      return {
        kind: "created",
        order: {
          orderId: order.order_id,
          status: "pending_payment",
          subtotalLkr: toLkrNumber(order.subtotal_lkr),
          lines: persistedLines.rows.map((line) => {
            const variantType = line.variant_type === "full_bottle" ? "full_bottle" : "decant";
            const unitPrice = prices.get(line.variant_id);
            if (unitPrice === undefined) throw new Error("Persisted line did not match a locked catalog variant.");
            return {
              variantId: line.variant_id,
              productName: line.product_name,
              brand: line.brand,
              variantType,
              sizeMl: line.size_ml,
              quantity: line.quantity,
              unitPriceLkr: Number(fromMinorUnits(unitPrice)),
              lineTotalLkr: toLkrNumber(line.line_total_lkr),
            };
          }),
        },
      };
    } finally {
      if (transactionStarted && client) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original database error while releasing the connection.
        }
      }
      client?.release();
    }
  };
}

export function createOrderReceiptRecovery(getPool: () => Pool | null) {
  return async function recoverOrderReceipt(
    lookup: OrderReceiptLookup,
  ): Promise<RecoverOrderReceiptResult> {
    const pool = getPool();
    if (!pool) return { kind: "storage_unavailable" };

    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      const result = await client.query<StoredOrderRow>(
        `SELECT
           o.id::text AS order_id,
           o.idempotency_request_hash AS request_fingerprint,
           o.subtotal_lkr::text,
           oi.variant_id::text,
           oi.product_name_snapshot AS product_name,
           oi.brand_snapshot AS brand,
           oi.variant_type_snapshot AS variant_type,
           oi.size_ml_snapshot AS size_ml,
           oi.quantity,
           oi.unit_price_lkr::text,
           oi.line_total_lkr::text
         FROM public.nidor_orders AS o
         LEFT JOIN public.nidor_order_items AS oi ON oi.order_id = o.id
         WHERE o.id = $1::uuid
           AND lower(o.customer_email) = $2
         ORDER BY oi.created_at, oi.id`,
        [lookup.orderId.toLowerCase(), lookup.customerEmail.trim().toLowerCase()],
      );
      if (result.rows.length === 0) return { kind: "not_found" };
      return { kind: "found", receipt: receiptForStoredOrder(result.rows) };
    } finally {
      client?.release();
    }
  };
}

export const placeNidorOrder = createOrderService(getNidorDatabasePool);
export const recoverNidorOrderReceipt = createOrderReceiptRecovery(getNidorDatabasePool);
