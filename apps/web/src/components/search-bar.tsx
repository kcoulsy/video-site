import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";

import { apiClient } from "@/lib/api-client";

interface SuggestResponse {
  suggestions: string[];
}

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);
  const navigate = useNavigate();

  const submitSearch = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setShowSuggestions(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
      navigate({ to: "/search", search: { q: trimmed } });
    },
    [navigate],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        const picked = suggestions[activeIndex];
        setQuery(picked);
        submitSearch(picked);
      } else {
        submitSearch(query);
      }
    },
    [query, activeIndex, suggestions, submitSearch],
  );

  const fetchSuggestions = useCallback(async (value: string) => {
    const seq = ++requestSeq.current;
    try {
      const data = await apiClient<SuggestResponse>(
        `/api/search/suggest?q=${encodeURIComponent(value)}`,
      );
      if (seq !== requestSeq.current) return;
      setSuggestions(data.suggestions);
    } catch {
      if (seq !== requestSeq.current) return;
      setSuggestions([]);
    }
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      setActiveIndex(-1);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (value.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      debounceTimer.current = setTimeout(() => {
        void fetchSuggestions(value.trim());
      }, 300);
    },
    [fetchSuggestions],
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setSuggestions([]);
    setActiveIndex(-1);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setShowSuggestions(false);
        setActiveIndex(-1);
        inputRef.current?.blur();
        return;
      }
      if (!showSuggestions || suggestions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      }
    },
    [showSuggestions, suggestions],
  );

  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setShowSuggestions(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const dropdownVisible = showSuggestions && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-lg">
      <form onSubmit={handleSubmit} className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search videos..."
          className="w-full rounded-full border border-border bg-secondary/60 py-2 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      {dropdownVisible && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        >
          {suggestions.map((suggestion, i) => (
            <li
              key={suggestion}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(suggestion);
                submitSearch(suggestion);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex cursor-pointer items-center gap-2 px-4 py-2 text-sm transition-colors ${
                i === activeIndex ? "bg-accent text-foreground" : "text-muted-foreground"
              }`}
            >
              <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="truncate">{suggestion}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
