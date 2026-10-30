/** Warning from 70 % of a limit, critical from 90 %. */
export function meterTone(value: number): "" | "ro-meter--warning" | "ro-meter--critical" {
  if (value >= 0.9) return "ro-meter--critical";
  if (value >= 0.7) return "ro-meter--warning";
  return "";
}

/** The signature gauge: equal segments, each a fixed share, lit up to the value. */
export function SegmentedMeter({
  value,
  label,
  segments = 20,
}: {
  /** Share used, from 0 to 1. */
  value: number;
  label: string;
  segments?: number;
}) {
  // A non-zero value always lights at least one segment.
  const lit = value > 0 ? Math.max(1, Math.round(Math.min(1, value) * segments)) : 0;
  return (
    <div
      className={`ro-meter ${meterTone(value)}`}
      style={{ ["--segments" as string]: segments }}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: segments }, (_, index) => (
        <span key={index} className={index < lit ? "is-lit" : undefined} />
      ))}
    </div>
  );
}
