interface ViewsBarChartProps {
  data: { date: string; views: number }[];
  height?: number;
}

export function ViewsBarChart({ data, height = 120 }: ViewsBarChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.views));
  const width = 100;
  const barWidth = width / data.length;
  const padX = barWidth * 0.15;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
      >
        {data.map((d, i) => {
          const h = (d.views / max) * (height - 16);
          return (
            <g key={d.date}>
              <rect
                x={i * barWidth + padX}
                y={height - h}
                width={barWidth - padX * 2}
                height={h}
                className="fill-primary/80"
              >
                <title>
                  {d.date}: {d.views} {d.views === 1 ? "view" : "views"}
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}
