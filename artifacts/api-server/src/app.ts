import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import type { IRouter } from "express";
import { createNidorCorsOptions, parseCorsAllowedOrigins } from "./lib/cors-config";
import router from "./routes";
import { logger } from "./lib/logger";
import resendWebhookRouter from "./routes/resend-webhook";

export function createApp(
  webhookRouter: IRouter = resendWebhookRouter,
  requestLogger: Logger = logger,
): Express {
  const app: Express = express();

  // Do not trust forwarded client-IP headers until the deployment proxy is verified.
  app.set("trust proxy", false);

  app.use(
    pinoHttp({
      logger: requestLogger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors(createNidorCorsOptions(parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS))));
  app.use("/api/webhooks/resend", express.raw({ type: "application/json", limit: "256kb" }), webhookRouter);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", router);
  return app;
}

const app = createApp();
export default app;
