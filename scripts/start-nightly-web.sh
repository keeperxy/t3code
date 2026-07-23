#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

bind_host="${T3CODE_NIGHTLY_HOST:-127.0.0.1}"
data_dir="${T3CODE_NIGHTLY_HOME:-$repo_root/.t3/nightly-main-plus-experimental}"
web_url="${T3CODE_NIGHTLY_WEB_URL:-}"
open_browser="${T3CODE_NIGHTLY_OPEN_BROWSER:-0}"
extra_args=()

print_usage() {
  cat <<'EOF'
Usage: ./scripts/start-nightly-web.sh [options] [dev-runner options]

Start the T3 Code server and Web UI from the current checkout.

Options:
  --host HOST       Bind the server and Web UI to HOST (default: 127.0.0.1).
  --home-dir PATH   Store runtime state in PATH.
  --web-url URL     Public Web URL used in the pairing link.
  --open-browser    Open the pairing URL in the system browser.
  --no-browser      Do not open a browser (default).
  -h, --help        Show this help.

Environment:
  T3CODE_NIGHTLY_HOST
  T3CODE_NIGHTLY_HOME
  T3CODE_NIGHTLY_WEB_URL
  T3CODE_NIGHTLY_OPEN_BROWSER=0|1

Examples:
  ./scripts/start-nightly-web.sh
  ./scripts/start-nightly-web.sh --open-browser
  ./scripts/start-nightly-web.sh \
    --host 0.0.0.0 \
    --web-url http://192.168.1.20:5733
EOF
}

while (($# > 0)); do
  case "$1" in
    --host)
      [[ $# -ge 2 ]] || {
        echo "Missing value for --host." >&2
        exit 2
      }
      bind_host="$2"
      shift 2
      ;;
    --home-dir)
      [[ $# -ge 2 ]] || {
        echo "Missing value for --home-dir." >&2
        exit 2
      }
      data_dir="$2"
      shift 2
      ;;
    --web-url)
      [[ $# -ge 2 ]] || {
        echo "Missing value for --web-url." >&2
        exit 2
      }
      web_url="$2"
      shift 2
      ;;
    --open-browser)
      open_browser=1
      shift
      ;;
    --no-browser)
      open_browser=0
      shift
      ;;
    -h | --help)
      print_usage
      exit 0
      ;;
    --)
      shift
      extra_args+=("$@")
      break
      ;;
    *)
      extra_args+=("$1")
      shift
      ;;
  esac
done

case "$open_browser" in
  0 | false | FALSE | no | NO)
    open_browser=0
    ;;
  1 | true | TRUE | yes | YES)
    open_browser=1
    ;;
  *)
    echo "T3CODE_NIGHTLY_OPEN_BROWSER must be 0 or 1." >&2
    exit 2
    ;;
esac

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack is required but was not found in PATH." >&2
  exit 1
fi

if [[ ! -x "$repo_root/node_modules/.bin/vp" ]]; then
  echo "Repository dependencies are missing. Run: corepack pnpm install" >&2
  exit 1
fi

cd "$repo_root"

current_branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [[ "$current_branch" != "nightly/main-plus-experimental" ]]; then
  echo "Warning: starting checkout '${current_branch:-detached HEAD}', not nightly/main-plus-experimental." >&2
fi

echo "Starting T3 Code Nightly Web UI"
echo "  Checkout: $repo_root"
echo "  State:    $data_dir"
echo "  Host:     $bind_host"
if [[ -n "$web_url" ]]; then
  echo "  Web URL:  $web_url"
else
  echo "  Web URL:  printed by the dev runner (normally http://localhost:5733)"
fi
echo "Open the complete pairing URL printed below on the first start."
echo "Press Ctrl+C to stop both the server and Web UI."
echo

runner_args=(
  run
  dev
  --home-dir
  "$data_dir"
  --host
  "$bind_host"
  --auto-bootstrap-project-from-cwd
)

if [[ -n "$web_url" ]]; then
  runner_args+=(--dev-url "$web_url")
fi

if ((open_browser == 1)); then
  runner_args+=(--browser)
fi

runner_args+=("${extra_args[@]}")

HOST="$bind_host" exec corepack pnpm exec vp "${runner_args[@]}"
