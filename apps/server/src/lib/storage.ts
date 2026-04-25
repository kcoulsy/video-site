import { env } from "@video-site/env/server";
import { createLocalStorage } from "@video-site/storage";

export const storage = createLocalStorage(env.STORAGE_PATH);
