import { createMiddleware } from "@tanstack/react-start";

import { authClient } from "@/lib/auth-client";

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const cookie = request.headers.get("cookie");
  const session = await authClient.getSession({
    fetchOptions: {
      // Forward only the browser cookie. Forwarding Host makes the API request
      // carry the web hostname through the proxy and breaks cross-subdomain auth.
      headers: cookie ? { cookie } : undefined,
      throw: true,
    },
  });
  return next({
    context: { session },
  });
});
