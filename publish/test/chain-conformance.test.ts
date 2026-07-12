import type { Address, Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import type { BaseSepoliaPublisher, OnChainEpoch } from '../src/adapters/base-sepolia-publisher.js';
import type { PublishEpochArgs } from '../src/adapters/types.js';
import type { EpochCountReader } from '../src/assert-genesis-publisher.js';
import { CHAIN_PUBLISHER_SCENARIOS, type ChainPublisherScenario } from './chain-publisher-scenarios.js';
import { getLocalChainHarness } from './local-chain-harness.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';

interface ConformancePublisher extends EpochCountReader {
  publishEpoch(args: PublishEpochArgs): Promise<Hex>;
  readLatestEpoch(publisher: Address): OnChainEpoch | Promise<OnChainEpoch>;
}

interface ScenarioResult {
  outcomes: Array<{ ok: true } | { ok: false; error: string }>;
  epochCount: bigint;
  latestEpoch?: Omit<OnChainEpoch, 'timestamp'>;
}

const KNOWN_REVERTS = [
  'genesis parentRoot must be zero',
  'parentRoot mismatch',
  'merkleRoot must be non-zero',
  'jsonlSha256 must be non-zero',
  'manifestHash must be non-zero',
  'invalid manifestUri length',
] as const;

function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return KNOWN_REVERTS.find((reason) => message.includes(reason)) ?? message;
}

async function runScenario(
  chainPublisher: ConformancePublisher,
  publisher: Address,
  scenario: ChainPublisherScenario,
): Promise<ScenarioResult> {
  const outcomes: ScenarioResult['outcomes'] = [];

  for (const step of scenario.steps) {
    try {
      await chainPublisher.publishEpoch(step.args);
      outcomes.push({ ok: true });
    } catch (error) {
      outcomes.push({ ok: false, error: normalizeError(error) });
    }
  }

  const epochCount = await chainPublisher.readEpochCount(publisher);
  if (epochCount === 0n) {
    return { outcomes, epochCount };
  }

  const latest = await chainPublisher.readLatestEpoch(publisher);
  expect(latest.timestamp).toBeGreaterThan(0n);
  const { timestamp: _timestamp, ...latestEpoch } = latest;
  return { outcomes, epochCount, latestEpoch };
}

describe('chain publisher conformance: mock equals real VincentAnchorRegistry', () => {
  for (const [index, scenario] of CHAIN_PUBLISHER_SCENARIOS.entries()) {
    it(scenario.name, async () => {
      const harness = await getLocalChainHarness();
      const account = harness.getAccount(index);
      const realPublisher: BaseSepoliaPublisher = harness.createPublisher(index);
      const mockPublisher = createMockChainPublisher({ publisher: account.address });

      const [mockResult, realResult] = await Promise.all([
        runScenario(mockPublisher, account.address, scenario),
        runScenario(realPublisher, account.address, scenario),
      ]);

      expect(realResult).toEqual(mockResult);
      expect(realResult.outcomes).toEqual(
        scenario.steps.map((step) =>
          step.error === undefined ? { ok: true } : { ok: false, error: step.error },
        ),
      );
    });
  }
});
