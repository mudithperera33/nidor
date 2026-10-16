import { ReplitConnectors } from "@replit/connectors-sdk";
import type { CreatedOrder } from "./order-service";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatLkr(value: number): string {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(value);
}

export function buildOrderReceiptEmail(receipt: CreatedOrder): {
  subject: string;
  text: string;
  html: string;
} {
  const lines = receipt.lines.map((line) => {
    const edition = line.variantType === "full_bottle" ? "Full bottle" : "Decant";
    return `${line.quantity} x ${line.productName} (${line.brand}) - ${edition}, ${line.sizeMl} ml\n`
      + `  ${formatLkr(line.unitPriceLkr)} each; line total ${formatLkr(line.lineTotalLkr)}`;
  });
  const rows = receipt.lines.map((line) => {
    const edition = line.variantType === "full_bottle" ? "Full bottle" : "Decant";
    const title = escapeHtml(`${line.productName} · ${line.brand} · ${edition}, ${line.sizeMl} ml`);
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #e7e2dc">${line.quantity} × ${title}<br>`
      + `<small>${formatLkr(line.unitPriceLkr)} each</small></td>`
      + `<td style="padding:12px 0;border-bottom:1px solid #e7e2dc;text-align:right">${formatLkr(line.lineTotalLkr)}</td></tr>`;
  }).join("");

  return {
    subject: `NIDOR order receipt · ${receipt.orderId}`,
    text: [
      "Your NIDOR order is saved and pending payment.",
      `Order reference: ${receipt.orderId}`,
      "",
      ...lines,
      "",
      `Order total: ${formatLkr(receipt.subtotalLkr)}`,
      "Payment has not been collected online. Payment must be confirmed separately before dispatch.",
    ].join("\n"),
    html: `<!doctype html><html><body style="margin:0;background:#f7f5f1;color:#24211e;font:16px/1.5 Arial,sans-serif">`
    + `<main style="max-width:600px;margin:32px auto;padding:32px;background:#fff">`
    + `<p style="letter-spacing:.16em;text-transform:uppercase;color:#776d60">NIDOR · Order receipt</p>`
    + `<h1 style="font-size:24px">Your order is saved</h1>`
    + `<p>Order reference: <strong>${escapeHtml(receipt.orderId)}</strong></p>`
    + `<p>Payment has not been collected online. Payment must be confirmed separately before dispatch.</p>`
    + `<table style="width:100%;border-collapse:collapse">${rows}</table>`
    + `<p style="display:flex;justify-content:space-between;font-size:18px"><strong>Order total</strong>`
    + `<strong>${formatLkr(receipt.subtotalLkr)}</strong></p>`
    + `</main></body></html>`,
  };
}

export async function sendOrderReceiptEmail(
  recipient: string,
  receipt: CreatedOrder,
  options: { apiKey?: string; from?: string; request?: typeof fetch } = {},
): Promise<string | null> {
  const from = (options.from ?? process.env.NIDOR_RECEIPT_FROM)?.trim();
  if (!from) {
    throw Object.assign(new Error("NIDOR_RECEIPT_FROM is not configured."), {
      code: "sender_not_configured",
    });
  }
  const email = buildOrderReceiptEmail(receipt);
  const body = {
    from,
    to: recipient,
    tags: [{ name: "nidor_order_id", value: receipt.orderId }],
    ...email,
  };
  const headers = { "Idempotency-Key": getOrderReceiptEmailIdempotencyKey(receipt.orderId) };
  const apiKey = (options.apiKey ?? process.env.RESEND_API_KEY)?.trim();
  if (!apiKey && process.env.VERCEL === "1") {
    throw Object.assign(new Error("RESEND_API_KEY must be configured on Vercel."), {
      code: "resend_not_configured",
    });
  }
  // The Replit connector remains available on Replit. Other hosts use the
  // standard Resend API with a server-only key configured on that host.
  const response = apiKey
    ? await (options.request ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        headers: { ...headers, Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    : await new ReplitConnectors().proxy("resend", "/emails", {
        method: "POST",
        headers,
        body,
      });
  if (!response.ok) {
    throw Object.assign(new Error("Resend rejected the receipt email."), {
      code: "resend_rejected",
      status: response.status,
    });
  }
  const payload = await response.json() as { id?: unknown };
  return typeof payload.id === "string" && payload.id.length <= 200 ? payload.id : null;
}

export function getOrderReceiptEmailIdempotencyKey(orderId: string): string {
  return `nidor-order-receipt-${orderId}`;
}
