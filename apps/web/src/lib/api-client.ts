import { env } from "@video-site/env/web";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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
    throw new ApiError(res.status, text || res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
