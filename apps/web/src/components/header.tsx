import { Link, useLocation, useSearch } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import { Menu, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@video-site/ui/components/button";

import { CategoryDrawerContent } from "./category-sidebar";
import { Logo } from "./logo";
import { NotificationBell } from "./notification-bell";
import { SearchBar } from "./search-bar";
import UserMenu from "./user-menu";

export default function Header() {
  const { pathname } = useLocation();
  const search = useSearch({ strict: false }) as { category?: string };
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer if the route changes (e.g. user picked a category from inside it).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  if (pathname.startsWith("/embed/")) return null;

  // Show the burger only on routes that actually have a category sidebar (currently the home feed).
  const showBurger = pathname === "/";

  return (
    <>
      <header
        data-header
        className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl"
      >
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-3 sm:gap-4 sm:px-4">
          {showBurger && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open categories"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}

          <Link to="/">
            <Logo />
          </Link>

          <SearchBar />

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/upload" />}
              className="hidden gap-2 sm:flex"
            >
              <Upload className="h-4 w-4" />
              <span>Upload</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Upload"
              render={<Link to="/upload" />}
              className="flex h-9 w-9 items-center justify-center p-0 sm:hidden"
            >
              <Upload className="h-4 w-4" />
            </Button>
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>

      {showBurger && drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            role="dialog"
            aria-label="Categories"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-background pb-6 shadow-xl"
          >
            <div className="flex items-center justify-between px-3 py-3">
              <span className="font-display text-lg italic tracking-tight">{env.VITE_APP_NAME}</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close categories"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-2">
              <CategoryDrawerContent
                selected={search.category}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
