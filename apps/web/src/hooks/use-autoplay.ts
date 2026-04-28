import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "watch:autoplay";

function read(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function useAutoplay(): [boolean, (value: boolean) => void] {
  const [autoplay, setAutoplayState] = useState<boolean>(read);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setAutoplayState(e.newValue === "true");
    };
    const onLocal = () => setAutoplayState(read());
    window.addEventListener("storage", onStorage);
    window.addEventListener("watch:autoplay-change", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("watch:autoplay-change", onLocal);
    };
  }, []);

  const setAutoplay = useCallback((value: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
    setAutoplayState(value);
    window.dispatchEvent(new Event("watch:autoplay-change"));
  }, []);

  return [autoplay, setAutoplay];
}
