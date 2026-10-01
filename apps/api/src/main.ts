import { Platform } from "./platform.ts";
import { createApp } from "./server.ts";
import { createLogger } from "../../../packages/observability/src/index.ts";

const port = Number(process.env.PORT ?? 4000);
const operators = Object.fromEntries(
  (process.env.OPERATOR_PHONES ?? "").split(",").filter(Boolean).map((p) => [p.trim(), ["ops.price_review", "ops.source_health", "ops.verification", "ops.listings", "ops.disputes", "ops.audit"]]),
);
const logger = createLogger();
const platform = new Platform({ operators: operators as never, deliverOtp: (phone, code) => {
    // Console provider: local development only. Never enabled when NODE_ENV=production.
    if (process.env.NODE_ENV !== "production" && (process.env.OTP_PROVIDER ?? "console") === "console") console.log(`[dev-otp] ${phone}: ${code}`);
  } });
createApp({ platform, logger }).listen(port, () => logger.info("api listening", { port }));
