# @kargain/vincent

Pure, deterministic functions over the VIN string — normalization, validation, check digit, model year, coarse region, and WMI lookup. Zero runtime dependencies.

Make/model decoding will ship in a future `vincent` decoder module (phase P).

## API

| Export | Description |
|--------|-------------|
| `normalizeVin(input)` | Trim, uppercase, strip whitespace and hyphens |
| `validateVin(input)` | Full validation with errors, warnings, check digit, region, and embedded `modelYear` |
| `lookupWmi(vinOrWmi)` | Resolve WMI metadata (manufacturer, country, vehicle type) from a WMI or full VIN |
| `computeCheckDigit(vin17)` | Compute position-9 check digit (throws on bad input) |
| `decodeModelYear(vin, options?)` | Decode model year from position 10 |
| `vinRegion(firstChar)` | Coarse ISO 3780 region from first character |
| `VIN_ALPHABET` | Standard VIN character set |
| `TRANSLITERATION` | Letter/digit values for check-digit math |
| `CHECK_DIGIT_WEIGHTS` | Position weights for check-digit computation |
| `YEAR_CODES` | Model-year code → base years (30-year cycle) |

## Usage

```ts
import { validateVin, decodeModelYear, lookupWmi } from '@kargain/vincent';

const result = validateVin('1-hgcm82633a004352');
// result.ok === true
// result.region === 'north-america'
// result.checkDigit.valid === true
// result.modelYear.best === 2003 (when cap leaves a single candidate)

const year = decodeModelYear(result.normalized);
// Same modelYear as result.modelYear; use standalone when options.now is needed

const wmi = lookupWmi('1HG');
// { wmi: '1HG', manufacturer: 'AMERICAN HONDA MOTOR CO., INC.', ... }
```

## Data provenance

WMI lookup data is imported from the NHTSA vPIC standalone PostgreSQL plain dump (`vPICList_lite_2026_06.plain.zip`), with provenance class `regulatory/us-vpic`. The compressed payload is committed as `src/wmi.generated.ts`; decompression uses vendored [tiny-inflate](https://github.com/devongovett/tiny-inflate) in `src/inflate.vendored.ts` and runs lazily on the first `lookupWmi` call.

Regenerate locally with `pnpm generate:wmi` from the repo root. CI and package builds use the committed artifact only — they never download source data.
