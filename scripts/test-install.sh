#!/bin/bash
# Drives scripts/install.sh the way a friend's Mac would see it, without ever
# installing anything on the Mac running the tests: every command that could
# change the system (xcode-select, curl, sudo, installer, open, uname, node)
# is a stub at the front of PATH, HOME is a throwaway folder, and Budget is
# cloned from a local bare repo seeded with this checkout's tracked files.
# BUDGET_INSTALL_SKIP_LAUNCH=1 is set on every run, so the installer stops
# right before starting Budget.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
INSTALL="$ROOT/scripts/install.sh"
PASS=0; FAIL=0
pass() { echo "  ok: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; echo "    $2"; FAIL=$((FAIL+1)); }
assert_has() { case "$1" in *"$2"*) pass "$3";; *) fail "$3" "expected to find: $2";; esac; }
assert_lacks() { case "$1" in *"$2"*) fail "$3" "should not contain: $2";; *) pass "$3";; esac; }

# One parent dir for everything this run creates, removed on the way out.
# Every fixture lives under it, including each fake HOME, so a stray path in
# the installer can only ever land in here.
SUITE_TMP=$(mktemp -d)
[ -n "$SUITE_TMP" ] || { echo "mktemp failed" >&2; exit 1; }
SUITE_TMP=$(cd "$SUITE_TMP" && pwd -P)
trap 'rm -rf "$SUITE_TMP"' EXIT

# Invented keys, letters and digits only like Plaid's. Never real values.
TEST_ID="testclientid0123456789ab"
TEST_SECRET="testsandboxsecret0123456789abc"

# A single bare origin is enough for every case: the installer only ever
# clones from it. Seeded from tracked files only, which is exactly what a
# friend receives (same seeding as test-launcher.sh's make_fixture).
# The stub git hands everything to this one, so cloning is real.
REAL_GIT=$(command -v git)
ORIGIN="$SUITE_TMP/origin.git"
git init -q --bare "$ORIGIN"
mkdir -p "$SUITE_TMP/seed"
( cd "$ROOT" && git ls-files -z | tar --null -T - -cf - ) | tar -xf - -C "$SUITE_TMP/seed"
# The installer under test may not be committed yet; ship the working copy.
cp "$INSTALL" "$SUITE_TMP/seed/scripts/install.sh" 2>/dev/null
git -C "$SUITE_TMP/seed" init -q -b main
git -C "$SUITE_TMP/seed" add -A
git -C "$SUITE_TMP/seed" -c user.email=t@test -c user.name=test commit -qm "seed"
git -C "$SUITE_TMP/seed" push -q "$ORIGIN" main

# Fake nodejs.org folder: a pretend .pkg and a SHASUMS256.txt that matches it.
DIST="$SUITE_TMP/dist"
mkdir -p "$DIST"
echo "pretend node installer" > "$DIST/node-v24.0.0.pkg"
PKG_SHA=$(shasum -a 256 "$DIST/node-v24.0.0.pkg" | awk '{print $1}')
{
  echo "0000000000000000000000000000000000000000000000000000000000000000  node-v24.0.0-darwin-arm64.tar.gz"
  echo "$PKG_SHA  node-v24.0.0.pkg"
  echo "1111111111111111111111111111111111111111111111111111111111111111  node-v24.0.0.tar.gz"
} > "$DIST/SHASUMS256.txt"

# A fresh "Mac": its own HOME, stub bin dir and state dir. Stubs read their
# behavior from files in state/, so a case can change the Mac between runs.
#   state/clt          present = Command Line Tools installed
#   state/clt-on-install  present = `xcode-select --install` makes them appear
#   state/node-version absent = node not installed
#   state/curl-fail    present = every download fails
#   state/os           what uname prints (default Darwin)
#   state/git-fails    N = the next N `git --version` calls fail (tools
#                      registered but git not in place yet)
#   state/*.log        what each stub was asked to do
make_mac() {
  local mac; mac=$(mktemp -d "$SUITE_TMP/mac.XXXXXX")
  mkdir -p "$mac/home" "$mac/bin" "$mac/state" "$mac/nodebin" "$mac/tmp"
  local s="$mac/state"

  cat > "$mac/bin/xcode-select" <<EOF
#!/bin/bash
case "\$1" in
  -p) [ -f "$s/clt" ] && { echo /Library/Developer/CommandLineTools; exit 0; }; exit 2 ;;
  --install) echo install >> "$s/xcode-select.log"
             [ -f "$s/clt-on-install" ] && touch "$s/clt"
             exit 0 ;;
esac
exit 1
EOF

  cat > "$mac/bin/git" <<EOF
#!/bin/bash
if [ "\$1" = --version ]; then
  echo version >> "$s/git.log"
  n=\$(cat "$s/git-fails" 2>/dev/null || echo 0)
  if [ "\$n" -gt 0 ]; then echo \$((n - 1)) > "$s/git-fails"; exit 1; fi
fi
exec "$REAL_GIT" "\$@"
EOF

  cat > "$mac/bin/node" <<EOF
#!/bin/bash
[ -f "$s/node-version" ] || exit 127
[ "\$1" = "--version" ] && cat "$s/node-version"
exit 0
EOF

  # Serves files from the fake dist folder by name; records every URL.
  cat > "$mac/bin/curl" <<EOF
#!/bin/bash
out="" url=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    -*) shift ;;
    *) url="\$1"; shift ;;
  esac
done
echo "\$url" >> "$s/curl.log"
[ -f "$s/curl-fail" ] && exit 22
src="$DIST/\${url##*/}"
[ -f "\$src" ] || exit 22
if [ -n "\$out" ]; then cp "\$src" "\$out"; else cat "\$src"; fi
EOF

  cat > "$mac/bin/sudo" <<EOF
#!/bin/bash
echo "\$*" >> "$s/sudo.log"
"\$@"
EOF

  # Records what it was asked to install and "installs" Node 24.
  cat > "$mac/bin/installer" <<EOF
#!/bin/bash
echo "\$*" >> "$s/installer.log"
echo v24.0.0 > "$s/node-version"
EOF

  cat > "$mac/bin/uname" <<EOF
#!/bin/bash
[ -f "$s/os" ] && cat "$s/os" || echo Darwin
EOF

  printf '#!/bin/bash\nexit 0\n' > "$mac/bin/open"
  chmod +x "$mac/bin/"*
  echo "$mac"
}

# Runs the installer on a fake Mac with the answers in $2 (a file). Extra
# args are env assignments (KEY=value) for this run only. Prints the output
# and leaves the exit code in $mac/state/rc, since callers capture output
# with $(...) and a subshell can't hand a variable back.
run_install() {
  local mac="$1" answers="$2"; shift 2
  # Refuse to run with a HOME outside the suite dir: the default BUDGET_DIR
  # is $HOME/Documents/budget and must never be the real one.
  case "$mac/home" in "$SUITE_TMP"/*) ;; *) echo "bad HOME $mac/home" >&2; exit 1 ;; esac
  ( cd "$mac" && env HOME="$mac/home" \
      PATH="$mac/bin:$PATH" \
      TMPDIR="$mac/tmp" \
      BUDGET_REPO="$ORIGIN" \
      BUDGET_TTY="$answers" \
      BUDGET_NODE_DIST="https://nodejs.example/dist/latest-v24.x" \
      BUDGET_NODE_BIN="$mac/nodebin" \
      BUDGET_CLT_WAIT_SECS=1 \
      BUDGET_POLL_SECS=1 \
      BUDGET_INSTALL_SKIP_LAUNCH=1 \
      "$@" \
      bash -c 'if [ "${VIA_PIPE:-}" = 1 ]; then cat "$1" | bash; else bash "$1"; fi' _ "$INSTALL" 2>&1 )
  echo $? > "$mac/state/rc"
}

rc_of() { cat "$1/state/rc"; }
env_value() { grep "^$2=" "$1" | head -1 | cut -d= -f2-; }
answers() { local f; f=$(mktemp "$SUITE_TMP/answers.XXXXXX"); printf '%s\n' "$@" > "$f"; echo "$f"; }

echo "installer: fresh Mac"
mac=$(make_mac)
touch "$mac/state/clt-on-install"
ans=$(answers "$TEST_ID" "$TEST_SECRET")
out=$(run_install "$mac" "$ans")
app="$mac/home/Documents/budget"
[ "$(rc_of "$mac")" = 0 ] && pass "fresh install exits 0" || fail "fresh install exits 0" "rc=$(rc_of "$mac"); output: $out"
grep -qx install "$mac/state/xcode-select.log" 2>/dev/null \
  && pass "asks macOS to install the command line tools" \
  || fail "asks macOS to install the command line tools" "no xcode-select --install call"
assert_has "$out" "Click Install" "tells the person what to click"
grep -q -- "-pkg $mac/tmp/budget-node\.[^/]*/node-v24.0.0.pkg -target /" "$mac/state/installer.log" 2>/dev/null \
  && pass "installs the downloaded Node.js package" \
  || fail "installs the downloaded Node.js package" "installer log: $(cat "$mac/state/installer.log" 2>/dev/null)"
grep -q "^installer " "$mac/state/sudo.log" 2>/dev/null \
  && pass "Node.js is installed through sudo" \
  || fail "Node.js is installed through sudo" "sudo log: $(cat "$mac/state/sudo.log" 2>/dev/null)"
grep -qx "https://nodejs.example/dist/latest-v24.x/SHASUMS256.txt" "$mac/state/curl.log" \
  && pass "fetches the checksum list from the Node.js folder" \
  || fail "fetches the checksum list from the Node.js folder" "$(cat "$mac/state/curl.log")"
assert_has "$out" "Nothing shows while you type" "explains the password prompt"
pkg_path=$(sed -n 's/.*-pkg \([^ ]*\) .*/\1/p' "$mac/state/installer.log" 2>/dev/null)
[ -n "$pkg_path" ] && [ ! -e "$(dirname "$pkg_path")" ] \
  && pass "the download folder is removed afterwards" \
  || fail "the download folder is removed afterwards" "still there: $pkg_path"
[ -f "$app/Budget.command" ] && [ -d "$app/.git" ] \
  && pass "clones Budget into ~/Documents/budget" \
  || fail "clones Budget into ~/Documents/budget" "nothing at $app"
key=$(env_value "$app/.env.local" TOKEN_STORE_KEY 2>/dev/null)
[ "${#key}" = 64 ] && pass ".env.local has a generated encryption key" \
                   || fail ".env.local has a generated encryption key" "TOKEN_STORE_KEY=$key"
grep -qx "PLAID_CLIENT_ID=$TEST_ID" "$app/.env.local" 2>/dev/null \
  && pass "writes the client_id" || fail "writes the client_id" "$(grep PLAID_ "$app/.env.local" 2>/dev/null)"
grep -qx "PLAID_SECRET=$TEST_SECRET" "$app/.env.local" 2>/dev/null \
  && pass "writes the secret" || fail "writes the secret" "$(grep PLAID_ "$app/.env.local" 2>/dev/null | cut -c1-14)"
[ "$(grep -c -e '^PLAID_CLIENT_ID=' -e '^PLAID_SECRET=' "$app/.env.local" 2>/dev/null)" = 2 ] \
  && pass "exactly one line per key" || fail "exactly one line per key" "$(grep -c -e '^PLAID_CLIENT_ID=' -e '^PLAID_SECRET=' "$app/.env.local")"
# Every line other than the two keys and the generated encryption key is the
# template's, unchanged.
diff <(grep -v -e '^PLAID_CLIENT_ID=' -e '^PLAID_SECRET=' -e '^TOKEN_STORE_KEY=' "$app/.env.local") \
     <(grep -v -e '^PLAID_CLIENT_ID=' -e '^PLAID_SECRET=' -e '^TOKEN_STORE_KEY=' "$app/.env.example") >/dev/null \
  && pass "no other line of .env.local changes" || fail "no other line of .env.local changes" "diff against .env.example"
assert_lacks "$out" "$TEST_SECRET" "the secret is never printed"
assert_lacks "$out" "paste them into .env.local" "Budget.command's own key instructions are silenced"
assert_has "$out" "Would run: ./Budget.command" "launches Budget last"
assert_lacks "$out" "--update" "a fresh clone is not launched with --update"

echo "installer: run again"
cp "$app/.env.local" "$SUITE_TMP/env-before"
: > "$mac/state/xcode-select.log"; : > "$mac/state/installer.log"; : > "$mac/state/curl.log"
empty=$(answers); : > "$empty"
out=$(run_install "$mac" "$empty")
[ "$(rc_of "$mac")" = 0 ] && pass "second run exits 0" || fail "second run exits 0" "rc=$(rc_of "$mac"); output: $out"
[ ! -s "$mac/state/xcode-select.log" ] && pass "no second tools install" || fail "no second tools install" "xcode-select --install called"
[ ! -s "$mac/state/installer.log" ] && pass "no second Node.js install" || fail "no second Node.js install" "installer called"
[ ! -s "$mac/state/curl.log" ] && pass "nothing downloaded" || fail "nothing downloaded" "$(cat "$mac/state/curl.log")"
assert_lacks "$out" "Paste your" "no questions asked"
cmp -s "$SUITE_TMP/env-before" "$app/.env.local" \
  && pass ".env.local is byte-identical" || fail ".env.local is byte-identical" "it changed"
assert_has "$out" "Would run: ./Budget.command --update" "an existing clone is launched with --update"

echo "installer: arrives through curl | bash"
# The script itself is on stdin here, so answers must come from BUDGET_TTY.
mac=$(make_mac); touch "$mac/state/clt"; echo v24.0.0 > "$mac/state/node-version"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")" VIA_PIPE=1)
[ "$(rc_of "$mac")" = 0 ] && pass "piped install exits 0" || fail "piped install exits 0" "rc=$(rc_of "$mac"); output: $out"
grep -qx "PLAID_SECRET=$TEST_SECRET" "$mac/home/Documents/budget/.env.local" 2>/dev/null \
  && pass "piped install reads answers from the keyboard" || fail "piped install reads answers from the keyboard" "secret not written"

echo "installer: Node.js versions"
mac=$(make_mac); touch "$mac/state/clt"; echo v18.19.0 > "$mac/state/node-version"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")")
[ "$(rc_of "$mac")" = 0 ] && [ -s "$mac/state/installer.log" ] \
  && pass "Node.js 18 is replaced" || fail "Node.js 18 is replaced" "rc=$(rc_of "$mac"); output: $out"
# Budget's Next.js needs 20.9 or newer.
mac=$(make_mac); touch "$mac/state/clt"; echo v20.8.1 > "$mac/state/node-version"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")")
[ "$(rc_of "$mac")" = 0 ] && [ -s "$mac/state/installer.log" ] \
  && pass "Node.js 20.8 is replaced" || fail "Node.js 20.8 is replaced" "rc=$(rc_of "$mac"); output: $out"
for v in v20.9.0 v22.1.0; do
  mac=$(make_mac); touch "$mac/state/clt"; echo "$v" > "$mac/state/node-version"
  out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")")
  [ "$(rc_of "$mac")" = 0 ] && pass "Node.js $v install exits 0" || fail "Node.js $v install exits 0" "rc=$(rc_of "$mac"); output: $out"
  [ ! -s "$mac/state/curl.log" ] && [ ! -s "$mac/state/installer.log" ] \
    && pass "Node.js $v is kept, nothing downloaded" || fail "Node.js $v is kept, nothing downloaded" "$(cat "$mac/state/curl.log")"
done

echo "installer: Node.js download problems"
mac=$(make_mac); touch "$mac/state/clt"
sed -i '' "s/^$PKG_SHA /$(printf '%064d' 7) /" "$DIST/SHASUMS256.txt"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")")
sed -i '' "s/^$(printf '%064d' 7) /$PKG_SHA /" "$DIST/SHASUMS256.txt"
[ "$(rc_of "$mac")" != 0 ] && pass "checksum mismatch exits non-zero" || fail "checksum mismatch exits non-zero" "rc=0"
[ ! -s "$mac/state/installer.log" ] && pass "a mismatched download is never installed" || fail "a mismatched download is never installed" "installer called"
assert_has "$out" "Download the LTS installer from https://nodejs.org" "points to nodejs.org"
[ ! -e "$mac/home/Documents/budget" ] && pass "nothing cloned after a failed Node.js install" || fail "nothing cloned after a failed Node.js install" "clone exists"
[ -z "$(ls -A "$mac/tmp")" ] && pass "the download folder is removed after a failure" || fail "the download folder is removed after a failure" "$(ls -A "$mac/tmp")"

mac=$(make_mac); touch "$mac/state/clt" "$mac/state/curl-fail"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")")
[ "$(rc_of "$mac")" != 0 ] && pass "a failed download exits non-zero" || fail "a failed download exits non-zero" "rc=0"
assert_has "$out" "Download the LTS installer from https://nodejs.org" "a failed download points to nodejs.org"

echo "installer: command line tools never appear"
mac=$(make_mac)
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")" BUDGET_CLT_WAIT_SECS=1)
[ "$(rc_of "$mac")" != 0 ] && pass "gives up waiting with a non-zero exit" || fail "gives up waiting with a non-zero exit" "rc=0"
assert_has "$out" "paste this line again" "says to finish the install and paste the line again"
[ ! -e "$mac/home/Documents/budget" ] && pass "nothing cloned without the tools" || fail "nothing cloned without the tools" "clone exists"

echo "installer: tools registered before git works"
mac=$(make_mac); touch "$mac/state/clt-on-install"; echo 1 > "$mac/state/git-fails"
echo v24.0.0 > "$mac/state/node-version"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")" BUDGET_CLT_WAIT_SECS=3)
[ "$(rc_of "$mac")" = 0 ] && pass "keeps waiting until git works" || fail "keeps waiting until git works" "rc=$(rc_of "$mac"); output: $out"
[ "$(grep -c version "$mac/state/git.log")" -ge 2 ] && pass "checks git again after the tools appear" \
  || fail "checks git again after the tools appear" "git --version calls: $(grep -c version "$mac/state/git.log")"
mac=$(make_mac); touch "$mac/state/clt-on-install"; echo 99 > "$mac/state/git-fails"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")" BUDGET_CLT_WAIT_SECS=1)
[ "$(rc_of "$mac")" != 0 ] && pass "gives up when git never works" || fail "gives up when git never works" "rc=0"
assert_has "$out" "The command line tools aren't installed yet" "says the tools aren't ready"
[ ! -e "$mac/home/Documents/budget" ] && pass "nothing cloned while git is missing" || fail "nothing cloned while git is missing" "clone exists"

echo "installer: Terminal not allowed in Documents"
mac=$(make_mac); touch "$mac/state/clt"; echo v24.0.0 > "$mac/state/node-version"
mkdir -p "$mac/home/Documents"; chmod 555 "$mac/home/Documents"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")")
chmod 755 "$mac/home/Documents"
[ "$(rc_of "$mac")" != 0 ] && pass "stops when Documents can't be written" || fail "stops when Documents can't be written" "rc=0"
assert_has "$out" "Privacy & Security" "says where to allow Terminal"
assert_lacks "$out" "internet connection" "doesn't blame the internet"
[ -z "$(ls -A "$mac/home/Documents")" ] && pass "leaves Documents as it was" || fail "leaves Documents as it was" "$(ls -A "$mac/home/Documents")"

echo "installer: a different folder is in the way"
mac=$(make_mac); touch "$mac/state/clt"; echo v24.0.0 > "$mac/state/node-version"
mkdir -p "$mac/home/Documents/budget"; echo "my notes" > "$mac/home/Documents/budget/notes.txt"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")")
[ "$(rc_of "$mac")" != 0 ] && pass "stops on a non-Budget folder" || fail "stops on a non-Budget folder" "rc=0"
assert_has "$out" "isn't Budget" "says the folder isn't Budget"
[ "$(ls -A "$mac/home/Documents/budget")" = "notes.txt" ] && [ "$(cat "$mac/home/Documents/budget/notes.txt")" = "my notes" ] \
  && pass "the folder is untouched" || fail "the folder is untouched" "$(ls -A "$mac/home/Documents/budget")"

echo "installer: bad key input"
mac=$(make_mac); touch "$mac/state/clt"; echo v24.0.0 > "$mac/state/node-version"
out=$(run_install "$mac" "$(answers "abc def" "abc def" "abc def")" BUDGET_DIR="$mac/home/elsewhere/budget")
[ "$(rc_of "$mac")" != 0 ] && pass "three bad answers exit non-zero" || fail "three bad answers exit non-zero" "rc=0"
assert_has "$out" "letters and numbers" "says what a key looks like"
[ -z "$(env_value "$mac/home/elsewhere/budget/.env.local" PLAID_CLIENT_ID)" ] \
  && [ -z "$(env_value "$mac/home/elsewhere/budget/.env.local" PLAID_SECRET)" ] \
  && pass "keys stay empty" || fail "keys stay empty" "$(grep PLAID_ "$mac/home/elsewhere/budget/.env.local" | cut -c1-20)"
[ -f "$mac/home/elsewhere/budget/Budget.command" ] && pass "BUDGET_DIR overrides where Budget goes" \
  || fail "BUDGET_DIR overrides where Budget goes" "nothing at $mac/home/elsewhere/budget"

echo "installer: not a Mac"
mac=$(make_mac); echo Linux > "$mac/state/os"
out=$(run_install "$mac" "$(answers "$TEST_ID" "$TEST_SECRET")")
[ "$(rc_of "$mac")" != 0 ] && pass "exits non-zero off macOS" || fail "exits non-zero off macOS" "rc=0"
assert_has "$out" "only works on a Mac" "says it needs a Mac"

echo "installer: no keyboard"
mac=$(make_mac)
out=$(run_install "$mac" "$mac/no-such-tty")
[ "$(rc_of "$mac")" != 0 ] && pass "exits non-zero without a keyboard" || fail "exits non-zero without a keyboard" "rc=0"
assert_has "$out" "paste this line into Terminal" "says to paste the line into Terminal"
[ ! -s "$mac/state/xcode-select.log" ] && pass "nothing installed without a keyboard" || fail "nothing installed without a keyboard" "xcode-select --install called"

echo "installer: safe to cut off mid-download"
[ "$(tail -n 1 "$INSTALL")" = 'main "$@"; exit $?' ] \
  && pass "the last line runs main" || fail "the last line runs main" "last line: $(tail -n 1 "$INSTALL")"
# At the left margin, only comments, function headers, closing braces and
# the last line are allowed: anything else would run before main() and could
# run from a half-downloaded script.
stray=$(sed '$d' "$INSTALL" | grep -nEv '^([[:space:]]|#|$|[a-z_]+\(\) \{$|\}$)')
[ -z "$stray" ] && pass "everything else is inside functions" || fail "everything else is inside functions" "$stray"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
