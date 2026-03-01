"use client";

import { useState, useEffect } from "react";
import { TransactionsTable } from "@/components/transactions-table";
import { PlaidLinkButton } from "@/components/plaid-link-button";
import {
  getStoredConnection,
  saveConnectionLocally,
  type Transaction,
  type Account,
  type Institution,
} from "@/lib/api";
import { listConnections } from "@/actions/list-connections";
import { getConnectionTransactions } from "@/actions/get-connection-transactions";

const USER_ID = "local-user-1";

export default function TransactionsPage() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function initializeConnection() {
      const stored = getStoredConnection();
      if (stored) {
        setConnectionId(stored.connectionId);
        setAccounts(stored.accounts);
        setInstitution(stored.institution);
        setIsLoading(false);
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

      setIsLoading(false);
    }

    initializeConnection();
  }, []);

  useEffect(() => {
    if (!connectionId) return;

    async function fetchTransactions() {
      setIsLoadingTx(true);
      setError(null);

      try {
        const result = await getConnectionTransactions({
          connectionId,
          accountId: selectedAccountId ?? undefined,
          limit: 500,
        });

        if (result.success && result.data) {
          setTransactions(result.data.transactions);
        } else {
          setError(result.error ?? "Failed to fetch transactions");
        }
      } catch (err: any) {
        setError(err.message ?? "Failed to fetch transactions");
      } finally {
        setIsLoadingTx(false);
      }
    }

    fetchTransactions();
  }, [connectionId, selectedAccountId]);

  const handlePlaidSuccess = async (connection: {
    connectionId: string;
    itemId: string;
    institution: Institution;
    accounts: Account[];
  }) => {
    setConnectionId(connection.connectionId);
    setAccounts(connection.accounts);
    setInstitution(connection.institution);
    setSelectedAccountId(null);

    saveConnectionLocally({
      connectionId: connection.connectionId,
      institutionName: connection.institution.name,
      accounts: connection.accounts,
      institution: connection.institution,
      savedAt: new Date().toISOString(),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!connectionId) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
          <p className="mt-1 text-sm text-gray-500">
            Connect a bank account to view transactions
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 mb-4">
            Connect your bank to see transactions
          </p>
          <PlaidLinkButton userId={USER_ID} onSuccess={handlePlaidSuccess} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
          <p className="mt-1 text-sm text-gray-500">
            {institution?.name ?? "Your bank"} •{" "}
            {isLoadingTx ? "Loading..." : `${transactions.length} transactions`}
          </p>
        </div>

        <select
          value={selectedAccountId ?? "all"}
          onChange={(e) =>
            setSelectedAccountId(e.target.value === "all" ? null : e.target.value)
          }
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              setIsLoadingTx(true);
              getConnectionTransactions({
                connectionId: connectionId!,
                accountId: selectedAccountId ?? undefined,
                limit: 500,
              }).then((result) => {
                if (result.success && result.data) {
                  setTransactions(result.data.transactions);
                } else {
                  setError(result.error ?? "Failed to fetch transactions");
                }
                setIsLoadingTx(false);
              });
            }}
            className="mt-2 text-sm underline"
          >
            Retry
          </button>
        </div>
      )}

      <TransactionsTable transactions={transactions} isLoading={isLoadingTx} />
    </div>
  );
}
