#!/bin/bash
# Guards against republishing personal data in the tracked source tree.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
pass() { echo "  ok: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; echo "    $2"; FAIL=$((FAIL+1)); }

echo "scrub checks"

# No absolute home paths anywhere in tracked files. docs/ is excluded because
# design docs legitimately discuss absolute paths. This file is excluded too:
# a test that searches for a string must be allowed to contain that string.
hits=$(cd "$ROOT" && git grep -nI '/Users/' -- . ':!docs/' ':!scripts/test-scrub.sh' 2>/dev/null)
[ -z "$hits" ] && pass "no /Users/ paths in tracked source" \
               || fail "no /Users/ paths in tracked source" "$hits"

# The maintainer's own category keywords -- an apartment building, particular
# restaurants, specific trips -- once lived in both the standalone Venmo
# sandbox and the app library that actually ships. Scrubbing one file and
# calling it done is exactly how the copy in src/lib/venmo.ts survived, so
# search every tracked file rather than the file the problem was found in.
# Case-insensitive: Title Case is the same disclosure as lowercase.
# docs/ is deliberately NOT excluded here -- a design doc that quotes the list
# publishes it just as surely as the code did.
#
# The list below is base64, not plaintext. This script is tracked, ships to
# every clone, and the README tells strangers to run it -- so typing the
# words themselves here would republish the exact personal details (an
# apartment building, restaurants, trips) this check exists to keep out,
# which is the same mistake that put a copy in src/lib/venmo.ts in the first
# place. Base64 isn't secrecy and isn't trying to be -- these aren't secrets,
# just details that shouldn't be casually greppable or search-engine-indexed
# in a public repo -- and it stays trivially reversible on purpose, because
# the point is to stop casual exposure, not to hide the check itself. If
# you're reading this because you decoded it: please don't "helpfully"
# paste the plaintext back in here. That reintroduces the exact leak this
# test exists to catch, only now excluded from its own search.
personal_hits=""
while IFS= read -r kw; do
  [ -n "$kw" ] || continue
  hit=$(cd "$ROOT" && git grep -nIiF -e "$kw" -- . 2>/dev/null)
  [ -n "$hit" ] && personal_hits="$personal_hits$hit
"
done < <(echo 'bmV3IHZpbGxhZ2UKbmV3dmlsbGFnZQptY3BvbGxvCm1lbmNocwpwb3RiZWxseQppcm9uIGFnZQpqb3NodWEgdHJlZQpnb2xmIHRyaXAKcGFydGlmdWwKYmFyY2Vsb25hCmV0aGlvcAo=' | base64 -d)
[ -z "$personal_hits" ] && pass "no personal category keywords in tracked files" \
                        || fail "no personal category keywords in tracked files" "$personal_hits"

# The design documents ship with the code, and they were written while the app
# still lived inside a private monorepo -- so they described its owner's home
# directory, named the private repo, and named the sibling projects next to it.
# None of that is anyone else's business. docs/ is exempt from the `/Users/`
# check above (a design doc may legitimately discuss absolute paths, and one
# code listing in there greps for that very literal), so this narrower list
# covers what that exemption would otherwise let through.
#
# Base64-encoded for the same reason as the keyword list above: this is a
# tracked file that ships to every clone, and writing the maintainer's home
# directory name and private repo/project names here in cleartext would be
# exactly the disclosure this check exists to prevent. Not a secret, just not
# casually greppable. Do not decode this back into the source.
private_hits=""
while IFS= read -r kw; do
  [ -n "$kw" ] || continue
  hit=$(cd "$ROOT" && git grep -nIiF -e "$kw" -- . 2>/dev/null)
  [ -n "$hit" ] && private_hits="$private_hits$hit
"
done < <(echo 'L1VzZXJzL3RhZXdvbgp0dy15b29uL2h1Ygpqb2JfbGlzdAptb25leV9sb2cK' | base64 -d)
[ -z "$private_hits" ] && pass "no private-monorepo references in tracked files" \
                       || fail "no private-monorepo references in tracked files" "$private_hits"

# The script must refuse to run with no arguments rather than silently
# reading someone else's Downloads folder.
out=$(node "$ROOT/scripts/venmo-categorize.mjs" 2>&1); rc=$?
[ $rc -ne 0 ] && pass "exits non-zero with no args" \
              || fail "exits non-zero with no args" "exit code was $rc"
case "$out" in *[Uu]sage*) pass "prints usage with no args";;
  *) fail "prints usage with no args" "got: $out";; esac

# Every env var the code reads must be documented in .env.example, so a
# fresh clone has a complete starting point.
if [ -f "$ROOT/.env.example" ]; then
  missing=""
  for v in DATABASE_URL PLAID_CLIENT_ID PLAID_SECRET PLAID_ENV TOKEN_STORE_KEY; do
    grep -qE "^${v}=" "$ROOT/.env.example" || missing="$missing $v"
  done
  [ -z "$missing" ] && pass ".env.example documents every required var" \
                    || fail ".env.example documents every required var" "missing:$missing"
else
  fail ".env.example exists" "file not found"
fi
[ -f "$ROOT/LICENSE" ] && pass "LICENSE exists" || fail "LICENSE exists" "file not found"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
