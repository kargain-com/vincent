import { matchExpression } from '@kargain/vincent/decoder';
import type { DecodeResult } from '@kargain/vincent/decoder';
import type { Claim } from '@kargain/vincent/protocol';

import { progress } from '../generate-wmi-internals.js';

export type SelfConsistencyFailureClass =
  | 'benign-ambiguity'
  | 'synth-mismatch'
  | 'real-decode-bug';

export interface SelfConsistencyFailureDiag {
  sampleIndex: number;
  classification: SelfConsistencyFailureClass;
  schemaRef: string;
  match: { vds: string; vis?: string };
  attribute: string;
  expectedCode: string;
  wmi: string;
  yearFrom: number;
  vin: string;
  decodeValue: string | null;
  ambiguous: boolean;
  candidates: string;
  vinMatchesPattern: boolean;
}

type PatternClaim = Extract<Claim, { type: 'vds-pattern' }>;
type BindingClaim = Extract<Claim, { type: 'vds-binding' }>;

export function classifySelfConsistencyFailure(
  vin: string,
  pattern: PatternClaim,
  result: DecodeResult,
): { classification: SelfConsistencyFailureClass; vinMatchesPattern: boolean } {
  const vinMatchesPattern = matchExpression(pattern.key.match, vin);
  if (!vinMatchesPattern) {
    return { classification: 'synth-mismatch', vinMatchesPattern: false };
  }

  const attr = result.attributes.find((a) => a.attribute === pattern.value.attribute);

  if (attr === undefined) {
    return { classification: 'real-decode-bug', vinMatchesPattern: true };
  }

  if (attr.ambiguous) {
    if (attr.candidates?.some((c) => c.value === pattern.value.code)) {
      return { classification: 'benign-ambiguity', vinMatchesPattern: true };
    }
    return { classification: 'benign-ambiguity', vinMatchesPattern: true };
  }

  if (attr.candidates !== undefined && attr.candidates.length > 1) {
    return { classification: 'benign-ambiguity', vinMatchesPattern: true };
  }

  if (attr.value !== pattern.value.code) {
    return { classification: 'real-decode-bug', vinMatchesPattern: true };
  }

  return { classification: 'benign-ambiguity', vinMatchesPattern: true };
}

export function buildFailureDiag(
  sampleIndex: number,
  pattern: PatternClaim,
  binding: BindingClaim,
  vin: string,
  result: DecodeResult,
): SelfConsistencyFailureDiag {
  const { classification, vinMatchesPattern } = classifySelfConsistencyFailure(
    vin,
    pattern,
    result,
  );
  const attr = result.attributes.find((a) => a.attribute === pattern.value.attribute);

  return {
    sampleIndex,
    classification,
    schemaRef: pattern.key.schema,
    match: {
      vds: pattern.key.match.vds,
      ...(pattern.key.match.vis !== undefined ? { vis: pattern.key.match.vis } : {}),
    },
    attribute: pattern.value.attribute,
    expectedCode: pattern.value.code,
    wmi: binding.key.wmi,
    yearFrom: binding.key.yearFrom,
    vin,
    decodeValue: attr?.value ?? null,
    ambiguous: attr?.ambiguous ?? false,
    candidates:
      attr?.candidates === undefined
        ? '-'
        : attr.candidates.map((c) => `${c.value}@${c.schema.slice(0, 12)}…`).join(', '),
    vinMatchesPattern,
  };
}

export function printSelfConsistencyFailureReport(
  failures: readonly SelfConsistencyFailureDiag[],
): void {
  const counts: Record<SelfConsistencyFailureClass, number> = {
    'benign-ambiguity': 0,
    'synth-mismatch': 0,
    'real-decode-bug': 0,
  };

  for (const failure of failures) {
    counts[failure.classification] += 1;
  }

  progress('Self-consistency failure diagnosis:');
  progress(
    `  counts: benign-ambiguity=${String(counts['benign-ambiguity'])}` +
      ` synth-mismatch=${String(counts['synth-mismatch'])}` +
      ` real-decode-bug=${String(counts['real-decode-bug'])}`,
  );

  for (const failure of failures) {
    progress(`  [${failure.classification}] sample #${String(failure.sampleIndex)}`);
    progress(`    schemaRef: ${failure.schemaRef}`);
    progress(
      `    pattern: vds=${failure.match.vds}` +
        (failure.match.vis === undefined ? '' : ` vis=${failure.match.vis}`),
    );
    progress(
      `    attribute=${failure.attribute} expectedCode=${failure.expectedCode} wmi=${failure.wmi} yearFrom=${String(failure.yearFrom)}`,
    );
    progress(`    vin: ${failure.vin} (matchesPattern=${String(failure.vinMatchesPattern)})`);
    progress(
      `    decoded: value=${failure.decodeValue ?? 'null'} ambiguous=${String(failure.ambiguous)} candidates=[${failure.candidates}]`,
    );
  }
}
