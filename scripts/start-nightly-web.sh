#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

bind_host="${T3CODE_NIGHTLY_HOST:-0.0.0.0}"
data_dir="${T3CODE_NIGHTLY_HOME:-$repo_root/.t3/nightly-main-plus-experimental}"
network_host="${T3CODE_NIGHTLY_NETWORK_HOST:-}"
web_url="${T3CODE_NIGHTLY_WEB_URL:-}"
api_url="${T3CODE_NIGHTLY_API_URL:-}"
server_port="${T3CODE_NIGHTLY_PORT:-13773}"
open_browser="${T3CODE_NIGHTLY_OPEN_BROWSER:-0}"
extra_args=()

detect_network_host() {
  local detected=""

  if command -v ip >/dev/null 2>&1; then
    detected="$(
      ip -4 route get 1.1.1.1 2>/dev/null |
      awk '{ for (field = 1; field <= NF; field++) if ($field == "src") { print $(field + 1); exit } }'
    )"
  fi

  if [[ -z "$detected" ]] && command -v hostname >/dev/null 2>&1; then
    detected="$(hostname -I 2>/dev/null | awk '{ print $1 }')"
  fi

  printf '%s' "$detected"
}

print_usage() {
  cat <<'EOF'
Usage: ./scripts/start-nightly-web.sh [options] [dev-runner options]

Start the T3 Code server and Web UI from the current checkout.

Options:
  --host HOST       Bind the server and Web UI to HOST (default: 0.0.0.0).
  --network-host IP Address clients use to reach this machine (auto-detected).
  --port PORT       Server/API port (default: 13773).
  --home-dir PATH   Store runtime state in PATH.
  --web-url URL     Public Web URL used in the pairing link.
  --api-url URL     Public API URL used by the Web UI.
  --open-browser    Open the pairing URL in the system browser.
  --no-browser      Do not open a browser (default).
  -h, --help        Show this help.

Environment:
  T3CODE_NIGHTLY_HOST
  T3CODE_NIGHTLY_NETWORK_HOST
  T3CODE_NIGHTLY_PORT
  T3CODE_NIGHTLY_HOME
  T3CODE_NIGHTLY_WEB_URL
  T3CODE_NIGHTLY_API_URL
  T3CODE_NIGHTLY_OPEN_BROWSER=0|1

Examples:
  ./scripts/start-nightly-web.sh
  ./scripts/start-nightly-web.sh --open-browser
  ./scripts/start-nightly-web.sh --network-host 192.168.1.20
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
    --network-host)
      [[ $# -ge 2 ]] || {
        echo "Missing value for --network-host." >&2
        exit 2
      }
      network_host="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || {
        echo "Missing value for --port." >&2
        exit 2
      }
      server_port="$2"
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
    --api-url)
      [[ $# -ge 2 ]] || {
        echo "Missing value for --api-url." >&2
        exit 2
      }
      api_url="$2"
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

if [[ ! "$server_port" =~ ^[0-9]+$ ]] || ((server_port < 1 || server_port > 65535)); then
  echo "T3CODE_NIGHTLY_PORT must be an integer between 1 and 65535." >&2
  exit 2
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack is required but was not found in PATH." >&2
  exit 1
fi

if [[ ! -x "$repo_root/node_modules/.bin/vp" ]]; then
  echo "Repository dependencies are missing. Run: corepack pnpm install" >&2
  exit 1
fi

if [[ -z "$network_host" ]]; then
  network_host="$(detect_network_host)"
fi

if [[ -z "$network_host" ]]; then
  echo "Could not detect a network address. Pass --network-host with this machine's LAN or Tailnet IP." >&2
  exit 1
fi

if [[ -z "$web_url" ]]; then
  web_url="http://$network_host:5733"
fi

if [[ -z "$api_url" ]]; then
  api_url="http://$network_host:$server_port"
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
echo "  Web URL:  $web_url"
echo "  API URL:  $api_url"
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
  --port
  "$server_port"
  --auto-bootstrap-project-from-cwd
  --dev-url
  "$web_url"
  --api-url
  "$api_url"
)

if ((open_browser == 1)); then
  runner_args+=(--browser)
fi

runner_args+=("${extra_args[@]}")

HOST="$bind_host" T3CODE_PORT_OFFSET=0 exec corepack pnpm exec vp "${runner_args[@]}"
