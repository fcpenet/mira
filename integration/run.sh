#!/usr/bin/env bash
# Run integration tests against real PostgreSQL and Redis containers.
# Testcontainers manages the containers — Docker must be running.
#
# Usage:
#   ./integration/run.sh                      # run all integration tests
#   ./integration/run.sh --testPathPattern=auth  # filter to one file
#   ./integration/run.sh --verbose            # pass extra flags to jest

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG="${SCRIPT_DIR}/config.ts"
STATE_FILE="${SCRIPT_DIR}/.integration-state.json"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()     { echo -e "${CYAN}[integration]${NC} $*"; }
success() { echo -e "${GREEN}[integration]${NC} $*"; }
warn()    { echo -e "${YELLOW}[integration]${NC} $*"; }
error()   { echo -e "${RED}[integration]${NC} $*"; }

# ── Cleanup — stop any leftover containers from a previous crashed run ────────
cleanup_stale_containers() {
  if [[ -f "${STATE_FILE}" ]]; then
    warn "stale state file found — cleaning up leftover containers..."
    PG_ID=$(node -e "process.stdout.write(require('${STATE_FILE}').pgContainerId)" 2>/dev/null || true)
    RD_ID=$(node -e "process.stdout.write(require('${STATE_FILE}').redisContainerId)" 2>/dev/null || true)

    for ID in "${PG_ID}" "${RD_ID}"; do
      if [[ -n "${ID}" ]]; then
        docker stop "${ID}" &>/dev/null && docker rm "${ID}" &>/dev/null && \
          warn "stopped stale container ${ID}" || true
      fi
    done

    rm -f "${STATE_FILE}"
  fi
}

# ── Trap — ensure containers are stopped even if the script is interrupted ────
trap 'cleanup_stale_containers' ERR INT TERM

# ── Pre-flight checks ─────────────────────────────────────────────────────────
log "checking prerequisites..."

if ! command -v docker &>/dev/null; then
  error "Docker is not installed or not in PATH"
  exit 1
fi

if ! docker info &>/dev/null; then
  error "Docker daemon is not running — start Docker and try again"
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
  warn "node_modules not found — running npm install..."
  npm install --prefix "${ROOT_DIR}"
fi

# ── Pull images if not cached ─────────────────────────────────────────────────
log "ensuring container images are available..."
docker pull postgres:16-alpine -q &
docker pull redis:7-alpine -q &
wait
log "images ready"

# ── Clean up any stale state from previous run ────────────────────────────────
cleanup_stale_containers

# ── Run tests ─────────────────────────────────────────────────────────────────
log "starting integration tests...\n"

START_TIME=$(date +%s)

set +e
npx jest \
  --config "${CONFIG}" \
  --runInBand \
  --forceExit \
  "$@" \
  2>&1
EXIT_CODE=$?
set -e

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
if [[ ${EXIT_CODE} -eq 0 ]]; then
  success "all integration tests passed (${ELAPSED}s)"
else
  error "integration tests failed (${ELAPSED}s)"
  cleanup_stale_containers
fi

exit ${EXIT_CODE}
