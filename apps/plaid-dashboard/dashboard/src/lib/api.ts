// ============================================================================
// Shared client types and local persistence helpers
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface Account {
  // Internal bank account UUID (database primary key)
  id: string;
  // Plaid account identifier
  accountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currency: string;
  currentBalance: number | null;
  availableBalance: number | null;
}

export interface Institution {
  institutionId: string;
  name: string;
  logoUrl: string | null;
}

export interface Transaction {
  plaidTransactionId: string;
  accountId: string;
  date: string;
  name: string;
  description: string | null;
  merchantName: string | null;
  amount: number;
  currency: string;
  category: string | null;
  categoryDetailed: string | null;
  method: string;
  status: "pending" | "posted";
}

const STORAGE_KEY = "plaid_connection";

export interface StoredConnection {
  connectionId: string;
  institutionName: string;
  accounts: Account[];
  institution: Institution;
  savedAt: string;
}

export function saveConnectionLocally(data: StoredConnection): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

export function getStoredConnection(): StoredConnection | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<StoredConnection>;
    if (
      !parsed.connectionId ||
      !parsed.institution ||
      !Array.isArray(parsed.accounts)
    ) {
      return null;
    }
    return parsed as StoredConnection;
  } catch {
    return null;
  }
}

export function clearStoredConnection(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}
