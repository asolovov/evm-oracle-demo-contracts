#!/bin/bash
# Verify every deployed contract on Etherscan (Ethereum Sepolia).
#
# Reads deployments/ethereum-sepolia/addresses.json, builds a per-contract
# constructor-args module on the fly, and invokes `hardhat --network sepolia
# verify etherscan` for each. Tolerates "already verified" responses.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY="${REPO_ROOT}/deployments/ethereum-sepolia/addresses.json"
ARGS_DIR="${REPO_ROOT}/deployments/ethereum-sepolia/.verify-args"
mkdir -p "${ARGS_DIR}"

if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required" >&2
    exit 1
fi

VERSION=1
REQUEST_FEE=0

DEPLOYER=$(jq -r '.deployer' "${DEPLOY}")
REPORTER_SET=$(jq -r '.reporterSet' "${DEPLOY}")
REPORTER_ADDRS=$(jq -c '.reporterAddresses' "${DEPLOY}")
THRESHOLD=$(jq -r '.threshold' "${DEPLOY}")
ORACLE_REGISTRY=$(jq -r '.oracleRegistry' "${DEPLOY}")

verify() {
    local label="$1"
    local address="$2"
    local fqn="$3"
    local args_module="$4"
    printf 'verifying %-28s %s ... ' "${label}" "${address}"
    output=$(cd "${REPO_ROOT}" && npx hardhat --network sepolia verify etherscan \
        --contract "${fqn}" \
        --constructor-args-path "${args_module}" \
        "${address}" 2>&1)
    if echo "${output}" | grep -qiE 'has already been verified|already verified|successfully verified|verification successful|HHE80022'; then
        echo "ok"
    else
        echo "FAIL"
        echo "${output}" | tail -5 | sed 's/^/  /'
    fi
}

# ReporterSet args
cat > "${ARGS_DIR}/reporterSet.cjs" <<EOF
module.exports = [
  "${DEPLOYER}",
  ${REPORTER_ADDRS},
  "${THRESHOLD}",
];
EOF
verify "ReporterSet" "${REPORTER_SET}" "src/core/ReporterSet.sol:ReporterSet" "${ARGS_DIR}/reporterSet.cjs"

# OracleRegistry args
cat > "${ARGS_DIR}/oracleRegistry.cjs" <<EOF
module.exports = ["${DEPLOYER}"];
EOF
verify "OracleRegistry" "${ORACLE_REGISTRY}" "src/core/OracleRegistry.sol:OracleRegistry" "${ARGS_DIR}/oracleRegistry.cjs"

# Each PriceAggregator
jq -c '.aggregators[]' "${DEPLOY}" | while read -r agg; do
    SYMBOL=$(echo "${agg}" | jq -r '.symbol')
    DESCRIPTION=$(echo "${agg}" | jq -r '.description')
    DECIMALS=$(echo "${agg}" | jq -r '.decimals')
    ASSET_ID=$(echo "${agg}" | jq -r '.assetId')
    ADDR=$(echo "${agg}" | jq -r '.address')

    args_file="${ARGS_DIR}/aggregator_${SYMBOL}.cjs"
    cat > "${args_file}" <<EOF
module.exports = [
  "${DEPLOYER}",
  "${REPORTER_SET}",
  "${ASSET_ID}",
  ${DECIMALS},
  "${DESCRIPTION}",
  "${VERSION}",
  "${REQUEST_FEE}",
];
EOF
    verify "PriceAggregator/${SYMBOL}" "${ADDR}" "src/core/PriceAggregator.sol:PriceAggregator" "${args_file}"
done
