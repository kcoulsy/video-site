import { Link, useLocation } from "@tanstack/react-router";
import { Film, Upload } from "lucide-react";
import { Button } from "@video-site/ui/components/button";

import { NotificationBell } from "./notification-bell";
import { SearchBar } from "./search-bar";
import UserMenu from "./user-menu";

export default function Header() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/embed/")) return null;
  return (
    <header
      data-header
      className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4">
        {/* Brand */}
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Film className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="hidden font-display text-xl italic tracking-tight sm:block">
            Watchbox
          </span>
        </Link>

        {/* Search */}
        <SearchBar />

        {/* Actions */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/upload" />}
            className="hidden gap-2 sm:flex"
          >
            <Upload className="h-4 w-4" />
            <span>Upload</span>
          </Button>
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
