# @kargain/vincent

Pure, deterministic functions over the VIN string — normalization, validation, check digit, model year, and coarse region. WMI lookup is a separate entry point with layered loading. Zero runtime dependencies.

Make/model decoding will ship in a future `vincent` decoder module (phase P).

## Entry points

| Entry | Approx. size (gzip) | Exports |
|-------|---------------------|---------|
| `@kargain/vincent` | ~3 KiB | Core deterministic APIs only — no WMI data |
| `@kargain/vincent/wmi` | ~40 KiB core + ~132 KiB extended on demand | `lookupWmi`, `WmiInfo` |

Extended WMI data (6-character codes for small manufacturers, position 3 = `9`) loads via dynamic `import()` only when needed. Mass-manufacturer 3-character WMIs load lazily on the first `lookupWmi` call.

## API

### `@kargain/vincent`

| Export | Description |
|--------|-------------|
| `normalizeVin(input)` | Trim, uppercase, strip whitespace and hyphens |
| `validateVin(input)` | Full validation with errors, warnings, check digit, region, and embedded `modelYear` |
| `computeCheckDigit(vin17)` | Compute position-9 check digit (throws on bad input) |
| `decodeModelYear(vin, options?)` | Decode model year from position 10 |
| `vinRegion(firstChar)` | Coarse ISO 3780 region from first character |
| `VIN_ALPHABET` | Standard VIN character set |
| `TRANSLITERATION` | Letter/digit values for check-digit math |
| `CHECK_DIGIT_WEIGHTS` | Position weights for check-digit computation |
| `YEAR_CODES` | Model-year code → base years (30-year cycle) |

### `@kargain/vincent/wmi`

| Export | Description |
|--------|-------------|
| `lookupWmi(vinOrWmi)` | `Promise<WmiInfo \| null>` — resolve WMI metadata (manufacturer, country, vehicle type) from a WMI or full VIN; awaits core decode and extended import when needed |

## Usage

```ts
import { validateVin, decodeModelYear } from '@kargain/vincent';
import { lookupWmi } from '@kargain/vincent/wmi';

const result = validateVin('1-hgcm82633a004352');
// result.ok === true
// result.region === 'north-america'
// result.checkDigit.valid === true
// result.modelYear.best === 2003 (when cap leaves a single candidate)

const year = decodeModelYear(result.normalized);
// Same modelYear as result.modelYear; use standalone when options.now is needed

const wmi = await lookupWmi('1HG');
// { wmi: '1HG', manufacturer: 'AMERICAN HONDA MOTOR CO., INC.', ... }
```

## Data provenance

WMI lookup data is imported from the NHTSA vPIC standalone PostgreSQL plain dump (`vPICList_lite_2026_06.plain.zip`), with provenance class `regulatory/us-vpic`. Two compressed payloads are committed:

- `src/wmi-core.generated.ts` — 3-character WMIs (3,155 entries)
- `src/wmi-extended.generated.ts` — 6-character WMIs (9,749 entries)

Decompression uses vendored [tiny-inflate](https://github.com/devongovett/tiny-inflate) in `src/inflate.vendored.ts`. Core data inflates lazily on the first `lookupWmi` call; extended data loads via dynamic `import()` when a lookup needs a 6-character candidate with position 3 = `9`.

Regenerate locally with `pnpm generate:wmi` from the repo root. CI and package builds use the committed artifacts only — they never download source data.
