import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getPlaidClient } from "../providers/plaid";
import {
  createAccounts,
  createConnection,
  getConnections,
  syncTransactions,
} from "../services/sync-service";

const auth = new Hono();

// ============================================================================
// Schemas
// ============================================================================

const linkTokenSchema = z.object({
  userId: z.string().min(1),
  accessToken: z.string().optional(), // For reconnection
});

const exchangeTokenSchema = z.object({
  publicToken: z.string().min(1),
});

const connectSchema = z.object({
  publicToken: z.string().min(1),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /auth/plaid/link
 * Create a Plaid Link token for initializing Plaid Link
 */
auth.post("/plaid/link", zValidator("json", linkTokenSchema), async (c) => {
  const { userId, accessToken } = c.req.valid("json");

  try {
    const plaid = getPlaidClient();
    const result = await plaid.createLinkToken({ userId, accessToken });

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Failed to create link token:",
      error instanceof Error ? error.message : error
    );
    return c.json(
      {
        success: false,
        error: "Failed to create link token",
      },
      500
    );
  }
});

/**
 * POST /auth/plaid/exchange
 * Exchange a public token for an access token after Plaid Link completion
 */
auth.post(
  "/plaid/connect",
  zValidator("json", connectSchema),
  async (c) => {
    const { publicToken } = c.req.valid("json");

    try {
      const plaid = getPlaidClient();

      // Exchange temporary public token for a long-lived access token.
      const exchangeResult = await plaid.exchangePublicToken(publicToken);

      // Fetch account metadata from Plaid.
      const accountsData = await plaid.getAccounts(exchangeResult.accessToken);

      // Persist connection (access token is encrypted at rest).
      const connectionId = await createConnection({
        accessToken: exchangeResult.accessToken,
        itemId: exchangeResult.itemId,
        institutionId: accountsData.institution.institutionId,
        institutionName: accountsData.institution.name,
        logoUrl: accountsData.institution.logoUrl ?? undefined,
      });

      await createAccounts(
        connectionId,
        accountsData.accounts.map((acc) => ({
          accountId: acc.accountId,
          name: acc.name,
          officialName: acc.officialName ?? undefined,
          type: acc.type,
          subtype: acc.subtype ?? undefined,
          mask: acc.mask ?? undefined,
          currency: acc.currency,
          currentBalance: acc.currentBalance ?? undefined,
          availableBalance: acc.availableBalance ?? undefined,
        }))
      );

      const syncResult = await syncTransactions(connectionId);
      const savedConnection = (await getConnections()).find(
        (connection) => connection.id === connectionId
      );

      if (!savedConnection) {
        throw new Error("Connection persisted but could not be reloaded");
      }

      const toNumber = (value: string | null): number | null => {
        if (value === null) {
          return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      return c.json({
        success: true,
        data: {
          connectionId,
          itemId: exchangeResult.itemId,
          institution: {
            institutionId: savedConnection.institutionId,
            name: savedConnection.name,
            logoUrl: savedConnection.logoUrl ?? null,
          },
          accounts: savedConnection.accounts.map((account) => ({
            id: account.id,
            accountId: account.accountId,
            name: account.name,
            officialName: account.officialName,
            type: account.type,
            subtype: account.subtype,
            mask: account.mask,
            currency: account.currency,
            currentBalance: toNumber(account.currentBalance),
            availableBalance: toNumber(account.availableBalance),
          })),
          accountsCount: accountsData.accounts.length,
          transactionsAdded: syncResult.added,
        },
      });
    } catch (error: any) {
      console.error(
        "Failed to connect Plaid account:",
        error instanceof Error ? error.message : error
      );
      return c.json(
        {
          success: false,
          error: "Failed to connect account",
        },
        500
      );
    }
  }
);

auth.post(
  "/plaid/exchange",
  zValidator("json", exchangeTokenSchema),
  async (c) => {
    const { publicToken } = c.req.valid("json");

    try {
      const plaid = getPlaidClient();
      const result = await plaid.exchangePublicToken(publicToken);

      return c.json({
        success: true,
        data: {
          itemId: result.itemId,
        },
      });
    } catch (error: any) {
      console.error(
        "Failed to exchange token:",
        error instanceof Error ? error.message : error
      );
      return c.json(
        {
          success: false,
          error: "Failed to exchange token",
        },
        500
      );
    }
  }
);

export { auth };
