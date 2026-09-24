// Lets `node --test` import app modules that use the "@/…" path alias
// (tsconfig "paths": "@/*" → "./src/*"). Next resolves the alias at build
// time; plain Node doesn't, so a module that imports another at runtime —
// earnings.ts pulling in rewards.ts and splits.ts — couldn't be loaded by a
// test without this. Loaded with --import ahead of the test files.
import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

const isFile = (p) => statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));
      const hit = [`${base}.ts`, path.join(base, "index.ts"), base].find(isFile);
      if (hit) return nextResolve(pathToFileURL(hit).href, context);
    }
    return nextResolve(specifier, context);
  },
});
