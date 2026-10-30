/** The product logo in the UI: the lowercase name and its static block cursor. */
export function Wordmark({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span className="ro-wordmark" style={{ ["--wordmark-size" as string]: `${size}px` }}>
      {name}
    </span>
  );
}
