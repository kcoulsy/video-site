interface WatchProgressBarProps {
  progressPercent: number;
}

export function WatchProgressBar({ progressPercent }: WatchProgressBarProps) {
  if (progressPercent <= 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
      <div
        className="h-full bg-red-600"
        style={{ width: `${Math.min(progressPercent * 100, 100)}%` }}
      />
    </div>
  );
}
