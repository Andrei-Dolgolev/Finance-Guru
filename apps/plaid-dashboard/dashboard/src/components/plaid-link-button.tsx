"use client";

import { useState, useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";
import { createPlaidLinkToken } from "@/actions/create-plaid-link";
import { exchangePublicToken } from "@/actions/exchange-public-token";
import type { Account, Institution } from "@/lib/api";

interface PlaidLinkButtonProps {
  userId: string;
  onSuccess?: (
    connection: {
      connectionId: string;
      itemId: string;
      institution: Institution;
      accounts: Account[];
    },
    metadata: any
  ) => void;
  onExit?: () => void;
  className?: string;
}

/**
 * Button component that opens Plaid Link
 * Following Midday's connect-transactions-modal.tsx pattern
 */
export function PlaidLinkButton({
  userId,
  onSuccess,
  onExit,
  className = "",
}: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch link token on mount
  useEffect(() => {
    async function fetchLinkToken() {
      setIsLoading(true);
      setError(null);

      const result = await createPlaidLinkToken(userId);

      if (result.success && result.data) {
        setLinkToken(result.data.linkToken);
      } else {
        setError(result.error ?? "Failed to initialize Plaid");
      }

      setIsLoading(false);
    }

    fetchLinkToken();
  }, [userId]);

  // Handle successful Plaid Link completion
  const handleSuccess = useCallback(
    async (publicToken: string, metadata: any) => {
      setIsLoading(true);

      const result = await exchangePublicToken(publicToken);

      if (result.success && result.data) {
        onSuccess?.(
          {
            connectionId: result.data.connectionId,
            itemId: result.data.itemId,
            institution: result.data.institution,
            accounts: result.data.accounts,
          },
          metadata
        );
      } else {
        setError(result.error ?? "Failed to connect account");
      }

      setIsLoading(false);
    },
    [onSuccess]
  );

  // Handle Plaid Link exit
  const handleExit = useCallback(() => {
    onExit?.();
  }, [onExit]);

  // Configure Plaid Link
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: handleExit,
  });

  // Render
  if (error) {
    return (
      <div className="text-red-500 text-sm">
        Error: {error}
        <button
          onClick={() => window.location.reload()}
          className="ml-2 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => open()}
      disabled={!ready || isLoading}
      className={`
        inline-flex items-center justify-center
        px-4 py-2 rounded-lg
        bg-blue-600 text-white font-medium
        hover:bg-blue-700
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-colors
        ${className}
      `}
    >
      {isLoading ? (
        <>
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Connecting...
        </>
      ) : (
        <>
          <svg
            className="mr-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          Connect Bank Account
        </>
      )}
    </button>
  );
}
