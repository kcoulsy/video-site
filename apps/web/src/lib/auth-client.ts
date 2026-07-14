import { env } from "@video-site/env/web";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  fetchOptions: {
    // The API is hosted on a sibling subdomain, so browser requests must opt
    // into credentials for Better Auth to persist and restore the session.
    credentials: "include",
  },
});
