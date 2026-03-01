import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";
import type {
  PlaidConfig,
  LinkTokenResponse,
  TokenExchangeResponse,
  GetAccountsResponse,
  GetTransactionsResponse,
  ConnectionStatus,
  SyncResult,
} from "./types";
import { transformAccounts, transformTransactions } from "./transform";

// ============================================================================
// Plaid API Wrapper
// Following Midday's plaid-api.ts pattern
// ============================================================================

export class PlaidApiWrapper {
  private client: PlaidApi;
  private clientId: string;
  private secret: string;
  private environment: "sandbox" | "production";

  constructor(config: PlaidConfig) {
    this.clientId = config.clientId;
    this.secret = config.secret;
    this.environment = config.environment;

    const configuration = new Configuration({
      basePath:
        config.environment === "production"
          ? PlaidEnvironments.production
          : PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": config.clientId,
          "PLAID-SECRET": config.secret,
        },
      },
    });

    this.client = new PlaidApi(configuration);
  }

  // ==========================================================================
  // Link Token & Authentication
  // ==========================================================================

  /**
   * Create a Link token for Plaid Link initialization
   * This is the first step in connecting a new bank account
   */
  async createLinkToken(params: {
    userId: string;
    accessToken?: string;
  }): Promise<LinkTokenResponse> {
    const request = {
      user: {
        client_user_id: params.userId,
      },
      client_name: "Finance Dashboard",
      products: params.accessToken ? undefined : [Products.Transactions],
      access_token: params.accessToken,
      country_codes: [CountryCode.Us],
      language: "en",
      // Request 2 years of transaction history
      transactions: {
        days_requested: 730,
      },
    };

    const response = await this.client.linkTokenCreate(request);

    return {
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
    };
  }

  /**
   * Exchange a public token for an access token
   * Called after user completes Plaid Link
   */
  async exchangePublicToken(
    publicToken: string
  ): Promise<TokenExchangeResponse> {
    const response = await this.client.itemPublicTokenExchange({
      public_token: publicToken,
    });

    return {
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    };
  }

  // ==========================================================================
  // Account Data
  // ==========================================================================

  /**
   * Get all accounts for an access token
   * Also fetches institution info for display
   */
  async getAccounts(accessToken: string): Promise<GetAccountsResponse> {
    // Get accounts
    const accountsResponse = await this.client.accountsGet({
      access_token: accessToken,
    });

    // Get institution info
    const institutionId = accountsResponse.data.item.institution_id;
    let institutionName = "Unknown Institution";
    let logoUrl: string | null = null;

    if (institutionId) {
      try {
        const institutionResponse = await this.client.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
          options: {
            include_optional_metadata: true,
          },
        });

        institutionName = institutionResponse.data.institution.name;
        logoUrl = institutionResponse.data.institution.logo ?? null;
      } catch (error) {
        console.warn(
          "Could not fetch institution details:",
          error instanceof Error ? error.message : error
        );
      }
    }

    return {
      accounts: transformAccounts(accountsResponse.data.accounts),
      institution: {
        institutionId: institutionId ?? "unknown",
        name: institutionName,
        logoUrl,
      },
    };
  }

  /**
   * Get current balance for a specific account
   */
  async getAccountBalance(
    accessToken: string,
    accountId: string
  ): Promise<{ current: number | null; available: number | null }> {
    const response = await this.client.accountsGet({
      access_token: accessToken,
      options: {
        account_ids: [accountId],
      },
    });

    const account = response.data.accounts[0];
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    return {
      current: account.balances.current,
      available: account.balances.available,
    };
  }

  // ==========================================================================
  // Transactions
  // ==========================================================================

  /**
   * Get transactions for an account
   * Two modes:
   * - latest: Get last 5 days (quick refresh)
   * - full: Get all transactions since a date
   */
  async getTransactions(params: {
    accessToken: string;
    accountId?: string;
    startDate?: string;
    endDate?: string;
    latest?: boolean;
  }): Promise<GetTransactionsResponse> {
    const { accessToken, accountId, latest } = params;

    // Calculate date range
    const endDate = params.endDate ?? new Date().toISOString().split("T")[0];
    let startDate = params.startDate;

    if (latest) {
      // Last 5 days for quick refresh
      const start = new Date();
      start.setDate(start.getDate() - 5);
      startDate = start.toISOString().split("T")[0];
    } else if (!startDate) {
      // Default to 90 days
      const start = new Date();
      start.setDate(start.getDate() - 90);
      startDate = start.toISOString().split("T")[0];
    }

    const response = await this.client.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: {
        account_ids: accountId ? [accountId] : undefined,
        include_personal_finance_category: true,
      },
    });

    // Filter out pending transactions for initial sync
    const postedTransactions = response.data.transactions.filter(
      (t) => !t.pending
    );

    return {
      transactions: transformTransactions(postedTransactions),
      hasMore: response.data.total_transactions > response.data.transactions.length,
    };
  }

  /**
   * Sync transactions using cursor-based pagination
   * This is the preferred method for ongoing syncs
   */
  async syncTransactions(params: {
    accessToken: string;
    cursor?: string;
  }): Promise<SyncResult> {
    const response = await this.client.transactionsSync({
      access_token: params.accessToken,
      cursor: params.cursor,
      options: {
        include_personal_finance_category: true,
      },
    });

    return {
      added: transformTransactions(response.data.added),
      modified: transformTransactions(response.data.modified),
      removed: response.data.removed.map((r) => r.transaction_id),
      hasMore: response.data.has_more,
      nextCursor: response.data.next_cursor,
    };
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /**
   * Check if a connection is still valid
   */
  async getConnectionStatus(accessToken: string): Promise<ConnectionStatus> {
    try {
      const response = await this.client.itemGet({
        access_token: accessToken,
      });

      const item = response.data.item;
      const error = item.error;

      if (error) {
        return {
          connected: false,
          error: error.error_message ?? "Unknown error",
        };
      }

      return {
        connected: true,
        lastRefresh: response.data.status?.transactions?.last_successful_update ?? undefined,
      };
    } catch (error: any) {
      return {
        connected: false,
        error: error.message ?? "Failed to check connection",
      };
    }
  }

  /**
   * Remove an item/connection
   */
  async removeConnection(accessToken: string): Promise<void> {
    await this.client.itemRemove({
      access_token: accessToken,
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let plaidInstance: PlaidApiWrapper | null = null;

export function getPlaidClient(): PlaidApiWrapper {
  if (!plaidInstance) {
    const clientId = process.env.PLAID_CLIENT_ID;
    const secret = process.env.PLAID_SECRET;
    const environment = process.env.PLAID_ENVIRONMENT as
      | "sandbox"
      | "production";

    if (!clientId || !secret) {
      throw new Error("PLAID_CLIENT_ID and PLAID_SECRET are required");
    }

    plaidInstance = new PlaidApiWrapper({
      clientId,
      secret,
      environment: environment ?? "sandbox",
    });
  }

  return plaidInstance;
}
