import { Button } from "@video-site/ui/components/button";
import { useEffect, useState } from "react";

const STORAGE_KEY = "watchbox:adult-site-age-confirmed";
const UNVERIFIED_CLASS = "adult-site-unverified";

export function AgeGate() {
  const [confirmed, setConfirmed] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    const isConfirmed = window.localStorage.getItem(STORAGE_KEY) === "true";
    setConfirmed(isConfirmed);
    if (isConfirmed) {
      document.documentElement.classList.remove(UNVERIFIED_CLASS);
    }
  }, []);

  const confirm = () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    document.documentElement.classList.remove(UNVERIFIED_CLASS);
    setConfirmed(true);
  };

  if (confirmed) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
    >
      <div className="w-full max-w-md border border-border bg-card p-6 text-center shadow-2xl">
        {declined ? (
          <>
            <h1 id="age-gate-title" className="font-display text-3xl">Access restricted</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              You must be of legal age in your location to enter this site.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-medium tracking-[0.2em] text-primary uppercase">Age verification</p>
            <h1 id="age-gate-title" className="mt-2 font-display text-3xl">Are you of legal age?</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              This site contains adult content. By entering, you confirm that you are of legal age to view it where you live.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button onClick={confirm}>I am of legal age</Button>
              <Button variant="outline" onClick={() => setDeclined(true)}>Leave site</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
