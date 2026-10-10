<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Releasing

Agents run `scripts/release.sh prepare <minor|patch>`; the owner runs
`scripts/release.sh publish`. `scan` and `publish` read the owner's real
database, so agents never run them. See
`docs/superpowers/specs/2026-10-09-release-script-design.md`.
