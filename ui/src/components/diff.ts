export type Part = { kind: "same" | "added" | "removed"; text: string };

/** Splits into words and the whitespace between them, so a diff keeps the original spacing. */
const tokens = (s: string) => s.split(/(\s+)/).filter(Boolean);

/**
 * Word diff by longest common subsequence. Cards are short; above a few million cells it falls back
 * to comparing whole lines so a huge card cannot freeze the page.
 */
export function diffWords(before: string, after: string): Part[] {
  let a = tokens(before);
  let b = tokens(after);
  if (a.length * b.length > 4_000_000) {
    a = before.split(/(?<=\n)/);
    b = after.split(/(?<=\n)/);
  }
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the common subsequence of a[i..] and b[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const out: Part[] = [];
  const push = (kind: Part["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) push("removed", a[i++]);
    else push("added", b[j++]);
  }
  while (i < n) push("removed", a[i++]);
  while (j < m) push("added", b[j++]);
  return out;
}
