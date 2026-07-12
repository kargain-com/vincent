import { network } from "hardhat";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, parseEther, toHex } from "viem";

const MERKLE_ROOT_1 = keccak256(toHex("merkle-root-1"));
const JSONL_SHA_1 = keccak256(toHex("jsonl-sha-1"));
const MANIFEST_HASH_1 = keccak256(toHex("manifest-hash-1"));
const MANIFEST_URI_1 = "ar://genesis-manifest";

const MERKLE_ROOT_2 = keccak256(toHex("merkle-root-2"));
const JSONL_SHA_2 = keccak256(toHex("jsonl-sha-2"));
const MANIFEST_HASH_2 = keccak256(toHex("manifest-hash-2"));
const MANIFEST_URI_2 = "ar://epoch-2-manifest";

describe("VincentAnchorRegistry", async () => {
  const { viem } = await network.create();

  async function deployRegistry() {
    return viem.deployContract("VincentAnchorRegistry");
  }

  async function defaultPublisher() {
    const [publisher] = await viem.getWalletClients();
    return publisher.account.address;
  }

  describe("publishEpoch", () => {
    it("accepts genesis publish with parentRoot zero", async () => {
      const registry = await deployRegistry();
      const publisher = await defaultPublisher();
      await registry.write.publishEpoch([
        MERKLE_ROOT_1,
        JSONL_SHA_1,
        MANIFEST_HASH_1,
        `0x${"0".repeat(64)}`,
        MANIFEST_URI_1,
      ]);

      assert.equal(await registry.read.epochCount([publisher]), 1n);
      const epoch = await registry.read.getEpoch([publisher, 0n]);
      assert.equal(epoch.merkleRoot, MERKLE_ROOT_1);
      assert.equal(epoch.jsonlSha256, JSONL_SHA_1);
      assert.equal(epoch.manifestHash, MANIFEST_HASH_1);
      assert.equal(epoch.parentRoot, `0x${"0".repeat(64)}`);
      assert.equal(epoch.manifestUri, MANIFEST_URI_1);
      assert.ok(epoch.timestamp > 0n);
    });

    it("reverts genesis with non-zero parentRoot", async () => {
      const registry = await deployRegistry();
      await viem.assertions.revertWith(
        registry.write.publishEpoch([
          MERKLE_ROOT_1,
          JSONL_SHA_1,
          MANIFEST_HASH_1,
          MERKLE_ROOT_2,
          MANIFEST_URI_1,
        ]),
        "genesis parentRoot must be zero",
      );
    });

    it("accepts second epoch with correct parentRoot", async () => {
      const registry = await deployRegistry();
      const publisher = await defaultPublisher();
      await registry.write.publishEpoch([
        MERKLE_ROOT_1,
        JSONL_SHA_1,
        MANIFEST_HASH_1,
        `0x${"0".repeat(64)}`,
        MANIFEST_URI_1,
      ]);
      await registry.write.publishEpoch([
        MERKLE_ROOT_2,
        JSONL_SHA_2,
        MANIFEST_HASH_2,
        MERKLE_ROOT_1,
        MANIFEST_URI_2,
      ]);

      assert.equal(await registry.read.epochCount([publisher]), 2n);
      const epoch = await registry.read.getEpoch([publisher, 1n]);
      assert.equal(epoch.merkleRoot, MERKLE_ROOT_2);
      assert.equal(epoch.parentRoot, MERKLE_ROOT_1);
    });

    it("reverts second epoch with wrong parentRoot", async () => {
      const registry = await deployRegistry();
      await registry.write.publishEpoch([
        MERKLE_ROOT_1,
        JSONL_SHA_1,
        MANIFEST_HASH_1,
        `0x${"0".repeat(64)}`,
        MANIFEST_URI_1,
      ]);
      await viem.assertions.revertWith(
        registry.write.publishEpoch([
          MERKLE_ROOT_2,
          JSONL_SHA_2,
          MANIFEST_HASH_2,
          MERKLE_ROOT_2,
          MANIFEST_URI_2,
        ]),
        "parentRoot mismatch",
      );
    });

    it("reverts zero merkleRoot", async () => {
      const registry = await deployRegistry();
      await viem.assertions.revertWith(
        registry.write.publishEpoch([
          `0x${"0".repeat(64)}`,
          JSONL_SHA_1,
          MANIFEST_HASH_1,
          `0x${"0".repeat(64)}`,
          MANIFEST_URI_1,
        ]),
        "merkleRoot must be non-zero",
      );
    });

    it("reverts zero jsonlSha256", async () => {
      const registry = await deployRegistry();
      await viem.assertions.revertWith(
        registry.write.publishEpoch([
          MERKLE_ROOT_1,
          `0x${"0".repeat(64)}`,
          MANIFEST_HASH_1,
          `0x${"0".repeat(64)}`,
          MANIFEST_URI_1,
        ]),
        "jsonlSha256 must be non-zero",
      );
    });

    it("reverts zero manifestHash", async () => {
      const registry = await deployRegistry();
      await viem.assertions.revertWith(
        registry.write.publishEpoch([
          MERKLE_ROOT_1,
          JSONL_SHA_1,
          `0x${"0".repeat(64)}`,
          `0x${"0".repeat(64)}`,
          MANIFEST_URI_1,
        ]),
        "manifestHash must be non-zero",
      );
    });

    it("reverts empty manifestUri", async () => {
      const registry = await deployRegistry();
      await viem.assertions.revertWith(
        registry.write.publishEpoch([
          MERKLE_ROOT_1,
          JSONL_SHA_1,
          MANIFEST_HASH_1,
          `0x${"0".repeat(64)}`,
          "",
        ]),
        "invalid manifestUri length",
      );
    });

    it("reverts oversized manifestUri", async () => {
      const registry = await deployRegistry();
      const longUri = "a".repeat(257);
      await viem.assertions.revertWith(
        registry.write.publishEpoch([
          MERKLE_ROOT_1,
          JSONL_SHA_1,
          MANIFEST_HASH_1,
          `0x${"0".repeat(64)}`,
          longUri,
        ]),
        "invalid manifestUri length",
      );
    });

    it("accepts manifestUri at max length 256", async () => {
      const registry = await deployRegistry();
      const publisher = await defaultPublisher();
      const maxUri = "b".repeat(256);
      await registry.write.publishEpoch([
        MERKLE_ROOT_1,
        JSONL_SHA_1,
        MANIFEST_HASH_1,
        `0x${"0".repeat(64)}`,
        maxUri,
      ]);
      const epoch = await registry.read.getEpoch([publisher, 0n]);
      assert.equal(epoch.manifestUri, maxUri);
    });
  });

  describe("multi-publisher isolation", () => {
    it("keeps independent epoch chains per publisher", async () => {
      const registry = await deployRegistry();
      const [publisherA, publisherB] = await viem.getWalletClients();

      await registry.write.publishEpoch(
        [
          MERKLE_ROOT_1,
          JSONL_SHA_1,
          MANIFEST_HASH_1,
          `0x${"0".repeat(64)}`,
          MANIFEST_URI_1,
        ],
        { account: publisherA.account },
      );

      const rootB = keccak256(toHex("merkle-root-b"));
      const jsonlB = keccak256(toHex("jsonl-b"));
      const manifestB = keccak256(toHex("manifest-b"));
      await registry.write.publishEpoch(
        [rootB, jsonlB, manifestB, `0x${"0".repeat(64)}`, "ar://b-genesis"],
        { account: publisherB.account },
      );

      assert.equal(await registry.read.epochCount([publisherA.account.address]), 1n);
      assert.equal(await registry.read.epochCount([publisherB.account.address]), 1n);

      const epochA = await registry.read.getEpoch([publisherA.account.address, 0n]);
      const epochB = await registry.read.getEpoch([publisherB.account.address, 0n]);
      assert.equal(epochA.merkleRoot, MERKLE_ROOT_1);
      assert.equal(epochB.merkleRoot, rootB);
    });
  });

  describe("EpochPublished event", () => {
    it("emits correct fields", async () => {
      const registry = await deployRegistry();
      const [publisher] = await viem.getWalletClients();

      await viem.assertions.emitWithArgs(
        registry.write.publishEpoch(
          [
            MERKLE_ROOT_1,
            JSONL_SHA_1,
            MANIFEST_HASH_1,
            `0x${"0".repeat(64)}`,
            MANIFEST_URI_1,
          ],
          { account: publisher.account },
        ),
        registry,
        "EpochPublished",
        [
          publisher.account.address,
          0n,
          MERKLE_ROOT_1,
          JSONL_SHA_1,
          MANIFEST_HASH_1,
          `0x${"0".repeat(64)}`,
          MANIFEST_URI_1,
        ],
      );
    });
  });

  describe("view functions", () => {
    it("returns correct epochCount, getEpoch, and latestEpoch", async () => {
      const registry = await deployRegistry();
      const publisher = await defaultPublisher();
      await registry.write.publishEpoch([
        MERKLE_ROOT_1,
        JSONL_SHA_1,
        MANIFEST_HASH_1,
        `0x${"0".repeat(64)}`,
        MANIFEST_URI_1,
      ]);
      await registry.write.publishEpoch([
        MERKLE_ROOT_2,
        JSONL_SHA_2,
        MANIFEST_HASH_2,
        MERKLE_ROOT_1,
        MANIFEST_URI_2,
      ]);

      assert.equal(await registry.read.epochCount([publisher]), 2n);

      const first = await registry.read.getEpoch([publisher, 0n]);
      assert.equal(first.merkleRoot, MERKLE_ROOT_1);

      const latest = await registry.read.latestEpoch([publisher]);
      assert.equal(latest.merkleRoot, MERKLE_ROOT_2);
      assert.equal(latest.manifestUri, MANIFEST_URI_2);
    });

    it("reverts getEpoch when out of range", async () => {
      const registry = await deployRegistry();
      await viem.assertions.revertWith(
        registry.read.getEpoch([registry.address, 0n]),
        "no such epoch",
      );
    });

    it("reverts latestEpoch when publisher has no epochs", async () => {
      const registry = await deployRegistry();
      const [, emptyPublisher] = await viem.getWalletClients();
      await viem.assertions.revertWith(
        registry.read.latestEpoch([emptyPublisher.account.address]),
        "no epochs",
      );
    });
  });

  describe("payable guards", () => {
    it("reverts when sending ether (no receive/fallback)", async () => {
      const registry = await deployRegistry();
      const [sender] = await viem.getWalletClients();
      const publicClient = await viem.getPublicClient();

      await viem.assertions.revert(
        sender.sendTransaction({
          to: registry.address,
          value: parseEther("1"),
        }),
      );

      const balance = await publicClient.getBalance({ address: registry.address });
      assert.equal(balance, 0n);
    });
  });

  describe("gas snapshot", () => {
    it("logs publishEpoch gas usage (informational)", async () => {
      const registry = await deployRegistry();
      const publicClient = await viem.getPublicClient();

      const hash = await registry.write.publishEpoch([
        MERKLE_ROOT_1,
        JSONL_SHA_1,
        MANIFEST_HASH_1,
        `0x${"0".repeat(64)}`,
        MANIFEST_URI_1,
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`[gas snapshot] publishEpoch (genesis): ${receipt.gasUsed} gas`);
    });
  });
});
