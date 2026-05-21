import { expect } from "chai";
import { network } from "hardhat";

import { deploySystem } from "../helpers/fixtures.js";

describe("Deployment smoke", () => {
  it("deploys the full system and wires the registry", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);

    const registry = await conn.viem.getContractAt("OracleRegistry", sys.registry);
    expect((await registry.read.listAssets()).length).to.equal(1);
    expect((await registry.read.getAggregator([sys.assetId])).toLowerCase()).to.equal(sys.aggregator.toLowerCase());

    const reporterSet = await conn.viem.getContractAt("ReporterSet", sys.reporterSet);
    expect(await reporterSet.read.getThreshold()).to.equal(sys.threshold);

    const aggregator = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);
    expect(await aggregator.read.decimals()).to.equal(8);
    expect(await aggregator.read.assetId()).to.equal(sys.assetId);
  });
});
