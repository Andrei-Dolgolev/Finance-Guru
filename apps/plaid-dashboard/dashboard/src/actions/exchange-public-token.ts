"use server";

import type { Account, Institution } from "@/lib/api";
import { engineRequest } from "./engine-request";

interface ExchangeTokenResponse {
  success: boolean;
  data?: {
    connectionId: string;
    itemId: string;
    institution: Institution;
    accounts: Account[];
    accountsCount: number;
    transactionsAdded: number;
  };
  error?: string;
}

/**
 * Server action to connect a Plaid account:
 * exchange public token, persist server-side connection, and return safe metadata.
 */
export async function exchangePublicToken(
  publicToken: string
): Promise<ExchangeTokenResponse> {
  try {
    const response = await engineRequest("/auth/plaid/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicToken }),
    });

    if (!response.ok) {
      throw new Error(`Engine API error: ${response.statusText}`);
    }

    return response.json();
  } catch (error: any) {
    console.error("Failed to exchange public token:", error);
    return {
      success: false,
      error: error.message ?? "Failed to exchange public token",
    };
  }
}
