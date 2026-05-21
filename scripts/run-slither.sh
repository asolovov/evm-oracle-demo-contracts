#!/bin/sh
# Resolves solc 0.8.24 in a portable way and runs Slither against slither-all.sol.
#
# Why this exists: Hardhat v3's build-info format isn't parseable by crytic-compile
# 0.3.x, so Slither runs against the standalone `slither-all.sol` aggregator file via
# solc directly. solc 0.8.24 must be available on the host; the easiest install path
# is `pip install solc-select && solc-select install 0.8.24 && solc-select use 0.8.24`,
# which puts a `solc` shim on PATH that defers to the selected version.

set -eu

# Allow override: SOLC=/path/to/solc-0.8.24 npm run slither
SOLC="${SOLC:-}"

if [ -z "$SOLC" ]; then
    # 1. solc-select shim — its `solc` wrapper reads ~/.solc-select/global-version.
    if command -v solc-select >/dev/null 2>&1; then
        SHIM_DIR="$(dirname "$(command -v solc-select)")"
        if [ -x "${SHIM_DIR}/solc" ]; then
            SOLC="${SHIM_DIR}/solc"
        fi
    fi

    # 2. Fall back to whatever `solc` is on PATH, but verify it's actually 0.8.24.
    if [ -z "$SOLC" ] && command -v solc >/dev/null 2>&1; then
        if solc --version 2>/dev/null | grep -q "0\.8\.24"; then
            SOLC=solc
        fi
    fi
fi

if [ -z "$SOLC" ]; then
    cat >&2 <<EOF
solc 0.8.24 not found.

Install via:
    pip install solc-select
    solc-select install 0.8.24
    solc-select use 0.8.24

Or set SOLC=/absolute/path/to/solc-0.8.24 in the environment.
EOF
    exit 1
fi

exec slither slither-all.sol --config-file slither.config.json --solc "$SOLC"
