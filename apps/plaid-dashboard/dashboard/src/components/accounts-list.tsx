"use client";

import { formatCurrency } from "@/lib/utils";
import type { Account, Institution } from "@/lib/api";

interface AccountsListProps {
  accounts: Account[];
  institution: Institution;
  selectedAccountId?: string;
  onSelectAccount?: (accountId: string) => void;
}

/**
 * Display a list of connected bank accounts
 */
export function AccountsList({
  accounts,
  institution,
  selectedAccountId,
  onSelectAccount,
}: AccountsListProps) {
  return (
    <div className="bg-white rounded-lg shadow">
      {/* Institution Header */}
      <div className="px-4 py-3 border-b flex items-center gap-3">
        {institution.logoUrl ? (
          <img
            src={institution.logoUrl}
            alt={institution.name}
            className="w-8 h-8 rounded"
          />
        ) : (
          <div className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center">
            <span className="text-gray-500 text-sm font-medium">
              {institution.name.charAt(0)}
            </span>
          </div>
        )}
        <span className="font-medium text-gray-900">{institution.name}</span>
      </div>

      {/* Account List */}
      <ul className="divide-y divide-gray-100">
        {accounts.map((account) => (
          <li
            key={account.id}
            onClick={() => onSelectAccount?.(account.id)}
            className={`
              px-4 py-3 flex items-center justify-between
              cursor-pointer hover:bg-gray-50 transition-colors
              ${selectedAccountId === account.id ? "bg-blue-50" : ""}
            `}
          >
            <div>
              <p className="font-medium text-gray-900">{account.name}</p>
              <p className="text-sm text-gray-500">
                {account.subtype ?? account.type}
                {account.mask && ` •••• ${account.mask}`}
              </p>
            </div>

            <div className="text-right">
              {account.currentBalance !== null && (
                <p className="font-medium text-gray-900">
                  {formatCurrency(account.currentBalance, account.currency)}
                </p>
              )}
              {account.availableBalance !== null &&
                account.availableBalance !== account.currentBalance && (
                  <p className="text-sm text-gray-500">
                    {formatCurrency(account.availableBalance, account.currency)}{" "}
                    available
                  </p>
                )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
