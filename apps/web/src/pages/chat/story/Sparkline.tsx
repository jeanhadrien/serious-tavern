import { SPARKLINE_SIZE, type Sparkline as SparklineData } from './sparklinePoints.js';

const SHOWN_IN_LABEL = 10;

/** A key's numeric history as a tiny inline SVG line (no chart library); the colour comes from CSS. */
export function Sparkline({ name, data }: { name: string; data: SparklineData }) {
  const { width, height } = SPARKLINE_SIZE;
  const recent = data.values.slice(-SHOWN_IN_LABEL);
  const more = data.values.length > recent.length ? 'latest ' : '';
  return (
    <svg
      className="story-spark"
      role="img"
      aria-label={`${name} over turns: ${more}${recent.join(', ')}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
    >
      <polyline points={data.points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={data.last.x} cy={data.last.y} r="2" fill="currentColor" />
    </svg>
  );
}
