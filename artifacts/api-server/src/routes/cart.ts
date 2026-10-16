import { Router, type IRouter } from "express";
import {
  ValidateCartBody,
  ValidateCartResponse,
  type CartValidationResponse,
} from "@workspace/api-zod";
import { getNidorDatabasePool } from "../lib/nidor-database";

type CartVariantRow = {
  variant_id: string;
  slug: string;
  name: string;
  brand: string;
  image_url: string;
  variant_type: string | null;
  size_ml: number;
  price_lkr: string | null;
  price_needs_configuration: boolean;
  stock_quantity: number;
  stock_needs_configuration: boolean;
};

type CatalogLookup = (variantIds: string[]) => Promise<CartVariantRow[] | null>;

async function lookupActiveCatalogVariants(variantIds: string[]): Promise<CartVariantRow[] | null> {
  const pool = getNidorDatabasePool();
  if (!pool) return null;
  const { rows } = await pool.query<CartVariantRow>(
    `SELECT
       v.id::text AS variant_id,
       p.slug,
       p.name,
       p.brand,
       p.image_url,
       to_jsonb(v)->>'variant_type' AS variant_type,
       v.size_ml,
       v.price_lkr::text AS price_lkr,
       v.price_needs_configuration,
       v.stock_quantity,
       v.stock_needs_configuration
     FROM public.product_variants AS v
     JOIN public.products AS p ON p.id = v.product_id
     WHERE v.id = ANY($1::uuid[])
       AND p.is_active = true
       AND v.is_active = true`,
    [variantIds],
  );
  return rows;
}

export function createCartRouter(catalogLookup: CatalogLookup = lookupActiveCatalogVariants): IRouter {
  const router: IRouter = Router();

  router.post("/cart/validate", async (req, res): Promise<void> => {
    const parsed = ValidateCartBody.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ issueCount: parsed.error.issues.length }, "Rejected invalid cart validation request");
      res.status(400).json({ error: "Provide valid variant IDs and quantities." });
      return;
    }

    if (new Set(parsed.data.lines.map((line) => line.variantId.toLowerCase())).size !== parsed.data.lines.length) {
      res.status(400).json({ error: "Include each variant only once." });
      return;
    }

    if (parsed.data.lines.length === 0) {
      res.json(ValidateCartResponse.parse({ lines: [] }));
      return;
    }

    try {
      const ids = parsed.data.lines.map((line) => line.variantId);
      const rows = await catalogLookup(ids);
      if (rows === null) {
        res.status(503).json({ error: "Current catalog data is unavailable." });
        return;
      }

      const byId = new Map(rows.map((row) => [row.variant_id, row]));
      const unsupportedType = rows.find((row) =>
        row.variant_type !== null && row.variant_type !== "decant" && row.variant_type !== "full_bottle",
      );
      if (unsupportedType) {
        req.log.error({ variantId: unsupportedType.variant_id }, "Catalog contains an unsupported variant type");
        res.status(503).json({ error: "Current catalog data is unavailable." });
        return;
      }

      const result: CartValidationResponse = {
        lines: parsed.data.lines.map((line) => {
          const row = byId.get(line.variantId);
          if (!row) {
            return {
              variantId: line.variantId,
              quantity: line.quantity,
              status: "unavailable",
              canPurchase: false,
              product: null,
              variant: null,
            };
          }

          const numericPrice = row.price_lkr === null ? null : Number(row.price_lkr);
          const priceLkr = numericPrice !== null && Number.isFinite(numericPrice) ? numericPrice : null;
          let status: CartValidationResponse["lines"][number]["status"] = "valid";
          if (row.price_needs_configuration || priceLkr === null) {
            status = "price_unconfigured";
          } else if (row.stock_needs_configuration) {
            status = "stock_unconfigured";
          } else if (row.stock_quantity <= 0) {
            status = "out_of_stock";
          } else if (line.quantity > row.stock_quantity) {
            status = "insufficient_stock";
          }

          return {
            variantId: line.variantId,
            quantity: line.quantity,
            status,
            canPurchase: status === "valid",
            product: {
              slug: row.slug,
              name: row.name,
              brand: row.brand,
              imageUrl: row.image_url,
            },
            variant: {
              variantType: row.variant_type === "full_bottle" ? "full_bottle" : "decant",
              sizeMl: row.size_ml,
              priceLkr,
              priceNeedsConfiguration: row.price_needs_configuration || priceLkr === null,
              stockQuantity: row.stock_quantity,
              stockNeedsConfiguration: row.stock_needs_configuration,
            },
          };
        }),
      };

      res.json(ValidateCartResponse.parse(result));
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unknown";
      req.log.error({ errorCode }, "Could not validate cart against the catalog");
      res.status(503).json({ error: "Unable to verify current prices and availability. Try again." });
    }
  });

  return router;
}

const router = createCartRouter();

export default router;
