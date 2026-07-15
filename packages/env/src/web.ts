import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
    VITE_WEB_URL: z.url(),
    VITE_APP_NAME: z.string().min(1).default("Watchbox"),
    // Set to "true" for sites that host adult content. This enables the
    // age gate and thumbnail obscuring in the web app.
    VITE_IS_ADULT_SITE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});
