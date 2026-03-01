"use server";

import { engineRequest } from "./engine-request";

interface LinkTokenResponse {
  success: boolean;
  data?: {
    linkToken: string;
    expiration: string;
  };
  error?: string;
}

/**
 * Server action to create a Plaid Link token
 * This is called from the client to initiate the Plaid Link flow
 */
export async function createPlaidLinkToken(
  userId: string
): Promise<LinkTokenResponse> {
  try {
    const response = await engineRequest("/auth/plaid/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      throw new Error(`Engine API error: ${response.statusText}`);
    }

    return response.json();
  } catch (error: any) {
    console.error("Failed to create link token:", error);
    return {
      success: false,
      error: error.message ?? "Failed to create link token",
    };
  }
}
