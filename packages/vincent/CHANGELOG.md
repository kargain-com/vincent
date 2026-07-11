# @kargain/vincent

## 0.2.0

### Minor Changes

- Split WMI lookup data into layered core (3-char) and extended (6-char) modules. `lookupWmi` now imports from `@kargain/vincent/wmi` instead of the main entry; `validateVin` and other core APIs are unchanged on `@kargain/vincent`.
- `lookupWmi` is async (`Promise<WmiInfo | null>`) so the first call always returns the final answer after any required data loads — same input always yields the same output.

## 0.1.0

### Minor Changes

- Initial release: deterministic VIN APIs (normalization, validation, check digit, model year, region) and WMI lookup from committed NHTSA vPIC data with pipeline generator.
