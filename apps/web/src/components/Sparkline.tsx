import { Line, LineChart, YAxis } from 'recharts';

interface SparklineProps {
  values: Array<number | null>;
  color?: string;
  width?: number;
  height?: number;
}

/**
 * Tiny inline chart for row trends. Skips axes/grid/tooltips for density.
 * Renders nothing if there's only 0–1 non-null points (no trend to draw).
 */
export function Sparkline({ values, color = '#f97316', width = 90, height = 22 }: SparklineProps) {
  const nonNull = values.filter((v): v is number => v != null);
  if (nonNull.length < 2) {
    return <div style={{ width, height }} className="text-[10px] text-muted-foreground/30">—</div>;
  }
  const data = values.map((v, i) => ({ i, v }));
  return (
    <LineChart width={width} height={height} data={data}>
      <YAxis hide domain={['dataMin', 'dataMax']} />
      <Line
        type="monotone"
        dataKey="v"
        stroke={color}
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
        connectNulls
      />
    </LineChart>
  );
}
