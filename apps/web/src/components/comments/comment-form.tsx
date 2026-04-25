import { Button } from "@video-site/ui/components/button";
import { useEffect, useRef, useState } from "react";

const MAX_LENGTH = 2000;

interface CommentFormProps {
  initialContent?: string;
  onSubmit: (content: string) => Promise<unknown> | void;
  onCancel?: () => void;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
}

export function CommentForm({
  initialContent = "",
  onSubmit,
  onCancel,
  placeholder = "Add a comment...",
  submitLabel = "Comment",
  autoFocus = false,
}: CommentFormProps) {
  const [content, setContent] = useState(initialContent);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [autoFocus]);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    adjustHeight();
  }, [content]);

  const trimmed = content.trim();
  const tooLong = content.length > MAX_LENGTH;
  const canSubmit = trimmed.length > 0 && !tooLong && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setContent("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        rows={1}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        className="w-full resize-none border-b border-border bg-transparent py-2 text-sm outline-none transition-colors focus:border-foreground"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className={tooLong ? "text-red-500" : ""}>
          {content.length}/{MAX_LENGTH}
        </span>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-full"
            >
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!canSubmit} className="rounded-full">
            {submitting ? "Posting..." : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
