import { env } from "@video-site/env/web";
import { Film } from "lucide-react";

interface LogoProps {
  showWordmark?: boolean;
  className?: string;
}

export function Logo({ showWordmark = true, className }: LogoProps) {
  return (
    <span className={`flex shrink-0 items-center gap-2.5 ${className ?? ""}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
        <Film className="h-4 w-4 text-primary-foreground" />
      </span>
      {showWordmark && (
        <span className="hidden font-display text-xl italic tracking-tight sm:block">
          {env.VITE_APP_NAME}
        </span>
      )}
    </span>
  );
}
