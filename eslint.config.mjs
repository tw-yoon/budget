import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Where a parallel dev server puts its build output (next.config.ts reads
    // NEXT_DIST_DIR; .claude/launch.json sets it). Same generated bundles as
    // .next/, just under another name — and thousands of lint problems if
    // left in, which drown out every real one.
    ".next-preview/**",
    // Session worktrees nest a full copy of the app — source from other
    // branches plus their own .next/ and .next-preview/ output. The patterns
    // above only match at the top level, so without this lint descends into
    // them and main fails on another branch's work or build output.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
