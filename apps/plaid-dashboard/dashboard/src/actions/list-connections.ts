"use server";

import type { Account, Institution } from "@/lib/api";
import { engineRequest } from "./engine-request";

interface RawConnectionAccount {
  id: string;
  accountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currency: string;
  currentBalance: string | number | null;
  availableBalance: string | number | null;
}

interface RawConnection {
  id: string;
  institutionId: string;
  name: string;
  logoUrl: string | null;
  accounts: RawConnectionAccount[];
}

export interface ConnectionSnapshot {
  connectionId: string;
  institution: Institution;
  accounts: Account[];
}

interface ListConnectionsResponse {
  success: boolean;
  data?: ConnectionSnapshot[];
  error?: string;
}

function toNumber(value: string | number | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function listConnections(): Promise<ListConnectionsResponse> {
  try {
    const response = await engineRequest("/sync/connections");
    if (!response.ok) {
      throw new Error(`Engine API error: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      success: boolean;
      data?: RawConnection[];
      error?: string;
    };

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error ?? "Failed to list connections",
      };
    }

    const data: ConnectionSnapshot[] = result.data.map((connection) => ({
      connectionId: connection.id,
      institution: {
        institutionId: connection.institutionId,
        name: connection.name,
        logoUrl: connection.logoUrl,
      },
      accounts: connection.accounts.map((account) => ({
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
    }));

    return { success: true, data };
  } catch (error: any) {
    console.error(
      "Failed to list connections:",
      error instanceof Error ? error.message : error
    );
    return {
      success: false,
      error: error.message ?? "Failed to list connections",
    };
  }
}
