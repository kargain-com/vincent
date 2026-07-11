# Security policy

## Reporting a vulnerability

Report security issues privately. Do not open a public GitHub issue for an undisclosed vulnerability.

Use [GitHub private security advisories](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/creating-a-repository-security-advisory) on the [kargain-com/vincent](https://github.com/kargain-com/vincent) repository. Select "Report a vulnerability" from the Security tab.

Include enough detail to reproduce the issue: affected package or protocol section, steps to trigger the weakness, and impact if known.

## Scope

In scope:

- Vulnerabilities in Vincent npm packages (`@kargain/vincent-*`)
- Build, test, or CI infrastructure under this repository
- Protocol-level weaknesses, including signature verification bypasses, canonicalization flaws, and hash-identity confusion

Out of scope:

- General VIN decoding accuracy disputes (use protocol issues instead)
- Third-party services not maintained in this repository

## Response

The maintainer will acknowledge reports in a reasonable timeframe and coordinate fixes and disclosure. Critical protocol issues may require a spec amendment via the process in [docs/GOVERNANCE.md](docs/GOVERNANCE.md).
