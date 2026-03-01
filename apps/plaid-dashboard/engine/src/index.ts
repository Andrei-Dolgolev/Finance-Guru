// Using Bun's native serve
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from parent directory (plaid-dashboard root)
config({ path: resolve(__dirname, "../../.env") });

import { auth } from "./routes/auth";
import { accounts } from "./routes/accounts";
import { transactions } from "./routes/transactions";
import { sync } from "./routes/sync";

// ============================================================================
// App Setup
// ============================================================================

const app = new Hono();
const internalApiKey = process.env.ENGINE_INTERNAL_API_KEY;
if (!internalApiKey && process.env.NODE_ENV === "production") {
  throw new Error("ENGINE_INTERNAL_API_KEY is required in production");
}

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "http://localhost:3002"], // Dashboard
    credentials: true,
  })
);
app.use("*", async (c, next) => {
  // Keep root health endpoint public.
  if (c.req.path === "/" || c.req.method === "OPTIONS") {
    await next();
    return;
  }

  if (!internalApiKey) {
    // Backward-compatible: when key isn't configured, do not block requests.
    // Configure ENGINE_INTERNAL_API_KEY in production.
    await next();
    return;
  }

  const providedKey = c.req.header("x-engine-api-key");
  if (!providedKey || providedKey !== internalApiKey) {
    return c.json(
      {
        success: false,
        error: "Unauthorized",
      },
      401
    );
  }

  await next();
});

// ============================================================================
// Routes
// ============================================================================

// Health check
app.get("/", (c) => {
  return c.json({
    name: "Plaid Dashboard Engine",
    version: "0.1.0",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Mount route groups
app.route("/auth", auth);
app.route("/accounts", accounts);
app.route("/transactions", transactions);
app.route("/sync", sync);

// ============================================================================
// Error Handling
// ============================================================================

app.onError((err, c) => {
  console.error("Unhandled error:", err instanceof Error ? err.message : err);
  return c.json(
    {
      success: false,
      error: "Internal server error",
    },
    500
  );
});

app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: "Not found",
    },
    404
  );
});

// ============================================================================
// Server
// ============================================================================

const port = 3001;

console.log(`
╔══════════════════════════════════════════╗
║     Plaid Dashboard Engine API           ║
║──────────────────────────────────────────║
║  Port: ${port}                              ║
║  Env:  ${process.env.PLAID_ENVIRONMENT ?? "sandbox"}                          ║
╚══════════════════════════════════════════╝
`);
if (!internalApiKey) {
  console.warn(
    "ENGINE_INTERNAL_API_KEY is not set. Configure it to restrict API access."
  );
}

// Export for Bun's native serve
export default {
  port,
  fetch: app.fetch,
};
