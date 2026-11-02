import { describe, expect, it } from "vitest";
import { diffWords } from "../ui/src/components/diff.js";

describe("diffWords", () => {
  it("marks changed words and keeps the rest", () => {
    const parts = diffWords("Pool size is 10 per instance.", "Pool size is 20 per instance.");
    expect(parts.filter((p) => p.kind === "removed").map((p) => p.text.trim())).toEqual(["10"]);
    expect(parts.filter((p) => p.kind === "added").map((p) => p.text.trim())).toEqual(["20"]);
    expect(parts.map((p) => (p.kind === "removed" ? "" : p.text)).join("")).toBe("Pool size is 20 per instance.");
  });

  it("returns one unchanged part for identical text", () => {
    expect(diffWords("a b", "a b")).toEqual([{ kind: "same", text: "a b" }]);
  });
});
