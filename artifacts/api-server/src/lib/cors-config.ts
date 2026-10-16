import type { CorsOptions } from "cors";

export function parseCorsAllowedOrigins(value: string | undefined): ReadonlySet<string> {
  const origins = new Set<string>();

  for (const candidate of (value ?? "").split(",")) {
    const origin = candidate.trim();
    if (!origin) continue;

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("CORS_ALLOWED_ORIGINS must contain comma-separated HTTP or HTTPS origins.");
    }

    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.origin !== origin
    ) {
      throw new Error("CORS_ALLOWED_ORIGINS must contain exact HTTP or HTTPS origins without paths.");
    }

    origins.add(parsed.origin);
  }

  return origins;
}

export function createNidorCorsOptions(allowedOrigins: ReadonlySet<string>): CorsOptions {
  return {
    origin(origin, callback) {
      // Same-origin and non-browser requests do not need CORS response headers.
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Idempotency-Key"],
    maxAge: 600,
  };
}
