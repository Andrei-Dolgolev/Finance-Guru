import { db } from "../db";
import {
  bankConnections,
  bankAccounts,
  transactions,
  type NewBankAccount,
} from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getPlaidClient } from "../providers/plaid";
import { decryptToken, encryptToken } from "../security/token-crypto";

// ============================================================================
// Sync Service
// Handles syncing data from Plaid to our database
// ============================================================================

/**
 * Create a new bank connection after Plaid Link
 */
export async function createConnection(params: {
  accessToken: string;
  itemId: string;
  institutionId: string;
  institutionName: string;
  logoUrl?: string;
}): Promise<string> {
  const [connection] = await db
    .insert(bankConnections)
    .values({
      accessToken: encryptToken(params.accessToken),
      itemId: params.itemId,
      institutionId: params.institutionId,
      name: params.institutionName,
      logoUrl: params.logoUrl ?? null,
      status: "connected",
    })
    .returning({ id: bankConnections.id });

  return connection.id;
}

/**
 * Create bank accounts for a connection
 */
export async function createAccounts(
  connectionId: string,
  accounts: Array<{
    accountId: string;
    name: string;
    officialName?: string;
    type: string;
    subtype?: string;
    mask?: string;
    currency: string;
    currentBalance?: number;
    availableBalance?: number;
  }>
): Promise<void> {
  const values: NewBankAccount[] = accounts.map((acc) => ({
    bankConnectionId: connectionId,
    accountId: acc.accountId,
    name: acc.name,
    officialName: acc.officialName ?? null,
    type: mapAccountType(acc.type),
    subtype: acc.subtype ?? null,
    mask: acc.mask ?? null,
    currency: acc.currency,
    currentBalance: acc.currentBalance?.toString() ?? null,
    availableBalance: acc.availableBalance?.toString() ?? null,
    enabled: true,
  }));

  await db.insert(bankAccounts).values(values);
}

/**
 * Sync transactions for a connection
 */
export async function syncTransactions(connectionId: string): Promise<{
  added: number;
  updated: number;
  removed: number;
}> {
  // Get connection details
  const connection = await db.query.bankConnections.findFirst({
    where: eq(bankConnections.id, connectionId),
    with: {
      accounts: true,
    },
  });

  if (!connection) {
    throw new Error(`Connection ${connectionId} not found`);
  }

  const decryptedAccessToken = decryptToken(connection.accessToken);

  const plaid = getPlaidClient();
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;

  // Sync each enabled account
  for (const account of connection.accounts) {
    if (!account.enabled) continue;

    try {
      // Get transactions from Plaid
      const result = await plaid.getTransactions({
        accessToken: decryptedAccessToken,
        accountId: account.accountId,
      });

      // Upsert transactions
      for (const tx of result.transactions) {
        const existing = await db.query.transactions.findFirst({
          where: eq(transactions.plaidTransactionId, tx.plaidTransactionId),
        });

        if (existing) {
          // Update existing
          await db
            .update(transactions)
            .set({
              name: tx.name,
              description: tx.description,
              merchantName: tx.merchantName,
              amount: tx.amount.toString(),
              category: tx.category,
              categoryDetailed: tx.categoryDetailed,
              method: tx.method,
              status: tx.status,
            })
            .where(eq(transactions.id, existing.id));
          totalUpdated++;
        } else {
          // Insert new
          await db.insert(transactions).values({
            bankAccountId: account.id,
            plaidTransactionId: tx.plaidTransactionId,
            date: tx.date,
            name: tx.name,
            description: tx.description,
            merchantName: tx.merchantName,
            amount: tx.amount.toString(),
            currency: tx.currency,
            category: tx.category,
            categoryDetailed: tx.categoryDetailed,
            method: tx.method,
            status: tx.status,
          });
          totalAdded++;
        }
      }

      // Update account balance
      const balance = await plaid.getAccountBalance(
        decryptedAccessToken,
        account.accountId
      );

      await db
        .update(bankAccounts)
        .set({
          currentBalance: balance.current?.toString() ?? null,
          availableBalance: balance.available?.toString() ?? null,
          updatedAt: new Date(),
        })
        .where(eq(bankAccounts.id, account.id));
    } catch (error) {
      console.error(
        `Failed to sync account ${account.accountId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  // Update connection last synced
  await db
    .update(bankConnections)
    .set({
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(bankConnections.id, connectionId));

  return {
    added: totalAdded,
    updated: totalUpdated,
    removed: totalRemoved,
  };
}

/**
 * Get all connections with their accounts
 */
export async function getConnections() {
  return db.query.bankConnections.findMany({
    columns: {
      id: true,
      institutionId: true,
      name: true,
      logoUrl: true,
      status: true,
      lastSyncedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      accounts: {
        columns: {
          id: true,
          accountId: true,
          name: true,
          officialName: true,
          type: true,
          subtype: true,
          mask: true,
          currency: true,
          currentBalance: true,
          availableBalance: true,
          enabled: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

/**
 * Get transactions for an account
 */
export async function getAccountTransactions(
  accountId: string,
  limit: number = 100
) {
  return db.query.transactions.findMany({
    where: eq(transactions.bankAccountId, accountId),
    orderBy: (transactions, { desc }) => [desc(transactions.date)],
    limit,
  });
}

/**
 * Get transactions for an entire connection or one account in that connection.
 */
export async function getConnectionTransactions(params: {
  connectionId: string;
  accountId?: string;
  limit?: number;
}) {
  const limit = params.limit ?? 200;

  const accountRows = await db.query.bankAccounts.findMany({
    where: params.accountId
      ? and(
          eq(bankAccounts.bankConnectionId, params.connectionId),
          eq(bankAccounts.id, params.accountId)
        )
      : eq(bankAccounts.bankConnectionId, params.connectionId),
    columns: { id: true },
  });

  const accountIds = accountRows.map((row) => row.id);
  if (accountIds.length === 0) {
    return [];
  }

  return db.query.transactions.findMany({
    where: inArray(transactions.bankAccountId, accountIds),
    orderBy: (tx, { desc }) => [desc(tx.date)],
    limit,
  });
}

// ============================================================================
// Helpers
// ============================================================================

function mapAccountType(
  type: string
): "depository" | "credit" | "loan" | "investment" | "other" {
  switch (type.toLowerCase()) {
    case "depository":
      return "depository";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
      return "investment";
    default:
      return "other";
  }
}
