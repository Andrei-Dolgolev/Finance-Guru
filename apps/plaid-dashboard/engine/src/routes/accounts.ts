import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getPlaidClient } from "../providers/plaid";

const accounts = new Hono();

// ============================================================================
// Schemas
// ============================================================================

const getAccountsSchema = z.object({
  accessToken: z.string().min(1),
});

const getBalanceSchema = z.object({
  accessToken: z.string().min(1),
  accountId: z.string().min(1),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /accounts
 * Get all accounts for an access token
 */
accounts.get("/", zValidator("query", getAccountsSchema), async (c) => {
  const { accessToken } = c.req.valid("query");

  try {
    const plaid = getPlaidClient();
    const result = await plaid.getAccounts(accessToken);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Failed to get accounts:",
      error instanceof Error ? error.message : error
    );
    return c.json(
      {
        success: false,
        error: "Failed to get accounts",
      },
      500
    );
  }
});

/**
 * GET /accounts/balance
 * Get current balance for a specific account
 */
accounts.get("/balance", zValidator("query", getBalanceSchema), async (c) => {
  const { accessToken, accountId } = c.req.valid("query");

  try {
    const plaid = getPlaidClient();
    const result = await plaid.getAccountBalance(accessToken, accountId);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Failed to get balance:",
      error instanceof Error ? error.message : error
    );
    return c.json(
      {
        success: false,
        error: "Failed to get balance",
      },
      500
    );
  }
});

/**
 * GET /accounts/status
 * Check connection status for an access token
 */
accounts.get("/status", zValidator("query", getAccountsSchema), async (c) => {
  const { accessToken } = c.req.valid("query");

  try {
    const plaid = getPlaidClient();
    const result = await plaid.getConnectionStatus(accessToken);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Failed to get connection status:",
      error instanceof Error ? error.message : error
    );
    return c.json(
      {
        success: false,
        error: "Failed to get connection status",
      },
      500
    );
  }
});

export { accounts };
