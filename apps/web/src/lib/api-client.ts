import { env } from "@video-site/env/web";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function apiClient<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.VITE_SERVER_URL}${path}`, {
    credentials: "include",
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let body: Record<string, unknown> | undefined;
    let message = text || res.statusText;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      body = parsed;
      if (typeof parsed.error === "string") message = parsed.error;
      if (typeof parsed.code === "string") code = parsed.code;
    } catch {
      // not JSON — keep raw text
    }
    throw new ApiError(res.status, message, code, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
