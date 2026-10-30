import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Agent worktrees live under .claude/; their tests are not ours.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});
