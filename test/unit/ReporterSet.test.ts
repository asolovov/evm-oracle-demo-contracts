import { expect } from "chai";
import { network } from "hardhat";
import { getAddress, zeroAddress } from "viem";

import { lower } from "../helpers/address.js";
import { expectRevertWithMessage } from "../helpers/reverts.js";

describe("ReporterSet", () => {
  it("constructor: bootstraps with reporters + threshold and emits ThresholdChanged", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const owner = wallets[0].account!.address;
    const reporters = [wallets[1].account!.address, wallets[2].account!.address, wallets[3].account!.address];

    const set = await conn.viem.deployContract("ReporterSet", [owner, reporters, 2n]);

    expect(await set.read.getThreshold()).to.equal(2n);
    expect(await set.read.getReporters()).to.have.length(3);
    for (const r of reporters) {
      expect(await set.read.isReporter([r])).to.equal(true);
    }
    expect(lower(await set.read.owner())).to.equal(lower(owner));
  });

  it("constructor: allows empty deploy with zero reporters + zero threshold", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, [], 0n]);
    expect(await set.read.getThreshold()).to.equal(0n);
    expect(await set.read.getReporters()).to.have.length(0);
  });

  it("constructor: reverts on zero threshold with non-empty reporters", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    await expectRevertWithMessage(
      () => conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, [wallets[1].account!.address], 0n]),
      "ZeroThreshold",
    );
  });

  it("constructor: reverts when threshold exceeds reporter count", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    await expectRevertWithMessage(
      () => conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, [wallets[1].account!.address], 2n]),
      "ThresholdExceedsReporterCount",
    );
  });

  it("constructor: reverts when a zero-address reporter is supplied", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    await expectRevertWithMessage(
      () => conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, [zeroAddress], 1n]),
      "ZeroReporter",
    );
  });

  it("constructor: reverts on duplicate reporter", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const dup = wallets[1].account!.address;
    await expectRevertWithMessage(
      () => conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, [dup, dup], 2n]),
      "ReporterAlreadyExists",
    );
  });

  it("addReporter: owner-only success path emits ReporterAdded", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const owner = wallets[0];
    const set = await conn.viem.deployContract("ReporterSet", [owner.account!.address, [], 0n]);

    await set.write.addReporter([wallets[1].account!.address]);
    expect(await set.read.isReporter([wallets[1].account!.address])).to.equal(true);
    expect(await set.read.getReporters()).to.have.length(1);

    const events = await set.getEvents.ReporterAdded();
    expect(events.length).to.be.greaterThan(0);
    expect(getAddress(events[events.length - 1].args.reporter!)).to.equal(getAddress(wallets[1].account!.address));
  });

  it("addReporter: rejects non-owner calls", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const owner = wallets[0];
    const stranger = wallets[2];
    const set = await conn.viem.deployContract("ReporterSet", [owner.account!.address, [], 0n]);

    const strangerSet = await conn.viem.getContractAt("ReporterSet", set.address, {
      client: { wallet: stranger },
    });
    await conn.viem.assertions.revertWithCustomError(
      strangerSet.write.addReporter([wallets[1].account!.address]),
      strangerSet,
      "OwnableUnauthorizedAccount",
    );
  });

  it("addReporter: rejects zero-address", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, [], 0n]);
    await conn.viem.assertions.revertWithCustomError(set.write.addReporter([zeroAddress]), set, "ZeroReporter");
  });

  it("addReporter: rejects duplicate", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, [], 0n]);
    await set.write.addReporter([wallets[1].account!.address]);
    await conn.viem.assertions.revertWithCustomError(
      set.write.addReporter([wallets[1].account!.address]),
      set,
      "ReporterAlreadyExists",
    );
  });

  it("removeReporter: swap-pop path (middle entry)", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reporters = [wallets[1].account!.address, wallets[2].account!.address, wallets[3].account!.address];
    const set = await conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, reporters, 2n]);

    await set.write.removeReporter([reporters[0]]);
    expect(await set.read.isReporter([reporters[0]])).to.equal(false);

    const remaining = (await set.read.getReporters()).map(lower);
    expect(remaining).to.have.length(2);
    expect(remaining).to.include(lower(reporters[1]));
    expect(remaining).to.include(lower(reporters[2]));
  });

  it("removeReporter: direct-pop path (last entry) + ReporterRemoved event", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reporters = [wallets[1].account!.address, wallets[2].account!.address];
    const set = await conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, reporters, 2n]);

    await set.write.setThreshold([1n]);
    await set.write.removeReporter([reporters[1]]);
    expect((await set.read.getReporters()).map(lower)).to.deep.equal([lower(reporters[0])]);

    const events = await set.getEvents.ReporterRemoved();
    expect(events.length).to.be.greaterThan(0);
    expect(getAddress(events[events.length - 1].args.reporter!)).to.equal(getAddress(reporters[1]));
  });

  it("removeReporter: reverts when the address is not in the set", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, [], 0n]);
    await conn.viem.assertions.revertWithCustomError(
      set.write.removeReporter([wallets[5].account!.address]),
      set,
      "ReporterNotFound",
    );
  });

  it("removeReporter: reverts when the removal would drop count below threshold", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reporters = [wallets[1].account!.address, wallets[2].account!.address];
    const set = await conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, reporters, 2n]);
    await conn.viem.assertions.revertWithCustomError(
      set.write.removeReporter([reporters[0]]),
      set,
      "ThresholdExceedsReporterCount",
    );
  });

  it("setThreshold: success path", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reporters = [wallets[1].account!.address, wallets[2].account!.address, wallets[3].account!.address];
    const set = await conn.viem.deployContract("ReporterSet", [wallets[0].account!.address, reporters, 2n]);

    await conn.viem.assertions.emitWithArgs(set.write.setThreshold([3n]), set, "ThresholdChanged", [2n, 3n]);
    expect(await set.read.getThreshold()).to.equal(3n);
  });

  it("setThreshold: zero revert", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("ReporterSet", [
      wallets[0].account!.address,
      [wallets[1].account!.address],
      1n,
    ]);
    await conn.viem.assertions.revertWithCustomError(set.write.setThreshold([0n]), set, "ZeroThreshold");
  });

  it("setThreshold: exceeds-count revert", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const set = await conn.viem.deployContract("ReporterSet", [
      wallets[0].account!.address,
      [wallets[1].account!.address],
      1n,
    ]);
    await conn.viem.assertions.revertWithCustomError(
      set.write.setThreshold([2n]),
      set,
      "ThresholdExceedsReporterCount",
    );
  });
});
