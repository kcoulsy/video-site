import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@video-site/ui/components/sonner";
import { useState } from "react";

import Header from "../components/header";

import appCss from "../index.css?url";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Watchbox" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Instrument+Serif:ital@0;1&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),

  component: RootDocument,
});

function RootDocument() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-svh antialiased">
        <QueryClientProvider client={queryClient}>
          <div className="flex min-h-svh flex-col">
            <Header />
            <main className="flex-1">
              <Outlet />
            </main>
          </div>
          <Toaster richColors />
          <TanStackRouterDevtools position="bottom-left" />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
