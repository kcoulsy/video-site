import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
    VITE_WEB_URL: z.url(),
    VITE_APP_NAME: z.string().min(1).default("Watchbox"),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});
