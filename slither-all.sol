// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Aggregator entry point for Slither.
//
// Slither's Hardhat-v3 backend cannot parse the v3 build-info format
// (`crytic-compile` 0.3.x errors out with `KeyError: 'output'`). Running Slither
// directly against `src/` produces "no contracts analyzed" because the directory
// isn't a recognised project root. This file gives Slither a single Solidity
// translation unit that imports every contract we want analysed; combined with
// `solc_remaps` in `slither.config.json` it gets a clean compile + full coverage.
//
// This file is NOT used by Hardhat compilation — only Slither.

// solhint-disable-next-line no-unused-import
import {PriceAggregator} from "./src/core/PriceAggregator.sol";
// solhint-disable-next-line no-unused-import
import {OracleRegistry} from "./src/core/OracleRegistry.sol";
// solhint-disable-next-line no-unused-import
import {ReporterSet} from "./src/core/ReporterSet.sol";
// solhint-disable-next-line no-unused-import
import {PriceLib} from "./src/libs/PriceLib.sol";
// solhint-disable-next-line no-unused-import
import {PriceConsumer} from "./src/consumers/PriceConsumer.sol";
