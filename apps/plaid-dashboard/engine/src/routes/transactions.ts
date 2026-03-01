import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getPlaidClient } from "../providers/plaid";

const transactions = new Hono();

// ============================================================================
// Schemas
// ============================================================================

const getTransactionsSchema = z.object({
  accessToken: z.string().min(1),
  accountId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  latest: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

const syncTransactionsSchema = z.object({
  accessToken: z.string().min(1),
  cursor: z.string().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /transactions
 * Get transactions for an access token
 */
transactions.get(
  "/",
  zValidator("query", getTransactionsSchema),
  async (c) => {
    const { accessToken, accountId, startDate, endDate, latest } =
      c.req.valid("query");

    try {
      const plaid = getPlaidClient();
      const result = await plaid.getTransactions({
        accessToken,
        accountId,
        startDate,
        endDate,
        latest,
      });

      return c.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error(
        "Failed to get transactions:",
        error instanceof Error ? error.message : error
      );
      return c.json(
        {
          success: false,
          error: "Failed to get transactions",
        },
        500
      );
    }
  }
);

/**
 * POST /transactions/sync
 * Sync transactions using cursor-based pagination
 */
transactions.post(
  "/sync",
  zValidator("json", syncTransactionsSchema),
  async (c) => {
    const { accessToken, cursor } = c.req.valid("json");

    try {
      const plaid = getPlaidClient();
      const result = await plaid.syncTransactions({ accessToken, cursor });

      return c.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error(
        "Failed to sync transactions:",
        error instanceof Error ? error.message : error
      );
      return c.json(
        {
          success: false,
          error: "Failed to sync transactions",
        },
        500
      );
    }
  }
);

export { transactions };
