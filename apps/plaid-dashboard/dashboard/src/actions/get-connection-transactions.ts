"use server";

import type { Transaction } from "@/lib/api";
import { engineRequest } from "./engine-request";

interface RawTransaction {
  plaidTransactionId: string;
  bankAccountId: string;
  date: string;
  name: string;
  description: string | null;
  merchantName: string | null;
  amount: string | number;
  currency: string;
  category: string | null;
  categoryDetailed: string | null;
  method: string;
  status: "pending" | "posted";
}

interface GetConnectionTransactionsResponse {
  success: boolean;
  data?: {
    transactions: Transaction[];
  };
  error?: string;
}

export async function getConnectionTransactions(params: {
  connectionId: string;
  accountId?: string;
  limit?: number;
}): Promise<GetConnectionTransactionsResponse> {
  try {
    const search = new URLSearchParams({ connectionId: params.connectionId });
    if (params.accountId) {
      search.set("accountId", params.accountId);
    }
    if (params.limit) {
      search.set("limit", String(params.limit));
    }

    const response = await engineRequest(`/sync/transactions?${search.toString()}`);
    if (!response.ok) {
      throw new Error(`Engine API error: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      success: boolean;
      data?: RawTransaction[];
      error?: string;
    };

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error ?? "Failed to get transactions",
      };
    }

    const transactions: Transaction[] = result.data.map((tx) => ({
      plaidTransactionId: tx.plaidTransactionId,
      accountId: tx.bankAccountId,
      date: tx.date,
      name: tx.name,
      description: tx.description,
      merchantName: tx.merchantName,
      amount: typeof tx.amount === "number" ? tx.amount : Number(tx.amount),
      currency: tx.currency,
      category: tx.category,
      categoryDetailed: tx.categoryDetailed,
      method: tx.method,
      status: tx.status,
    }));

    return {
      success: true,
      data: { transactions },
    };
  } catch (error: any) {
    console.error(
      "Failed to get connection transactions:",
      error instanceof Error ? error.message : error
    );
    return {
      success: false,
      error: error.message ?? "Failed to get transactions",
    };
  }
}
