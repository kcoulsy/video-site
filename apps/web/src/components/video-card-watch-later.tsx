import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Clock } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

interface VideoCardWatchLaterProps {
  videoId: string;
}

export function VideoCardWatchLater({ videoId }: VideoCardWatchLaterProps) {
  const { data: session } = authClient.useSession();
  const isAuthed = !!session?.user;
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const mutate = useMutation({
    mutationFn: () =>
      apiClient<{ saved: boolean }>(`/api/watch-later/${videoId}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.setQueryData(["watch-later-status", videoId], { saved: true });
      queryClient.invalidateQueries({ queryKey: ["watch-later"] });
      setConfirmed(true);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setConfirmed(false), 1500);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    },
  });

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthed) {
      toast.message("Sign in to save videos");
      return;
    }
    if (confirmed || mutate.isPending) return;
    mutate.mutate();
  };

  const label = confirmed ? "Added to Watch Later" : "Watch later";

  return (
    <div
      className={`absolute right-1 top-1 z-10 transition-opacity duration-150 ${
        confirmed ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
      }`}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={label}
        className="group/btn peer relative flex h-9 w-9 items-center justify-center rounded-full bg-black/85 text-white shadow-md backdrop-blur-sm transition-transform hover:scale-105 hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        {confirmed ? (
          <Check className="h-4 w-4 animate-in zoom-in-50 duration-200" strokeWidth={2.5} />
        ) : (
          <Clock className="h-4 w-4" strokeWidth={2.25} />
        )}
      </button>

      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full mt-1.5 whitespace-nowrap rounded-md bg-black/90 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-md backdrop-blur-sm transition-opacity duration-100 peer-hover:opacity-100 peer-focus-visible:opacity-100"
      >
        {label}
      </span>
    </div>
  );
}
