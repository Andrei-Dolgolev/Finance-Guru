import "server-only";
import { getEngineUrl } from "@/lib/utils";

function getEngineApiKey(): string | null {
  const key = process.env.ENGINE_INTERNAL_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

export async function engineRequest(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const engineUrl = getEngineUrl();
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const apiKey = getEngineApiKey();
  if (apiKey) {
    headers.set("x-engine-api-key", apiKey);
  }

  return fetch(`${engineUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}
