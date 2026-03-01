"use client";

import { useEffect, useState } from "react";
import { AccountsList } from "@/components/accounts-list";
import { PlaidLinkButton } from "@/components/plaid-link-button";
import {
  getStoredConnection,
  saveConnectionLocally,
  type Account,
  type Institution,
} from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { listConnections } from "@/actions/list-connections";

const USER_ID = "local-user-1";

export default function AccountsPage() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadExistingConnection() {
      const stored = getStoredConnection();
      if (stored) {
        setConnectionId(stored.connectionId);
        setAccounts(stored.accounts);
        setInstitution(stored.institution);
        return;
      }

      const connectionsResult = await listConnections();
      if (connectionsResult.success && connectionsResult.data?.length) {
        const first = connectionsResult.data[0];
        setConnectionId(first.connectionId);
        setAccounts(first.accounts);
        setInstitution(first.institution);

        saveConnectionLocally({
          connectionId: first.connectionId,
          institutionName: first.institution.name,
          accounts: first.accounts,
          institution: first.institution,
          savedAt: new Date().toISOString(),
        });
      }
    }

    loadExistingConnection();
  }, []);

  const handlePlaidSuccess = async (connection: {
    connectionId: string;
    itemId: string;
    institution: Institution;
    accounts: Account[];
  }) => {
    setIsLoading(true);
    setError(null);

    try {
      setConnectionId(connection.connectionId);
      setAccounts(connection.accounts);
      setInstitution(connection.institution);

      saveConnectionLocally({
        connectionId: connection.connectionId,
        institutionName: connection.institution.name,
        accounts: connection.accounts,
        institution: connection.institution,
        savedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      setError(err.message ?? "Failed to load accounts");
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate totals
  const totalBalance = accounts.reduce(
    (sum, acc) => sum + (acc.currentBalance ?? 0),
    0
  );

  // Not connected yet
  if (!connectionId) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Connect a bank account to view your balances
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 mb-4">
            Connect your bank to see accounts
          </p>
          <PlaidLinkButton userId={USER_ID} onSuccess={handlePlaidSuccess} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            {accounts.length} accounts connected
          </p>
        </div>
        <PlaidLinkButton
          userId={USER_ID}
          onSuccess={handlePlaidSuccess}
          className="text-sm"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Total Balance Card */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg shadow p-6 text-white">
        <p className="text-blue-100 text-sm font-medium">Total Balance</p>
        <p className="text-3xl font-bold mt-1">
          {formatCurrency(totalBalance)}
        </p>
        <p className="text-blue-100 text-sm mt-2">
          Across {accounts.length} accounts
        </p>
      </div>

      {/* Accounts List */}
      {isLoading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
          <p className="mt-2 text-gray-500">Loading accounts...</p>
        </div>
      ) : institution ? (
        <AccountsList accounts={accounts} institution={institution} />
      ) : null}
    </div>
  );
}
