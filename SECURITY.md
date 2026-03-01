# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in Mimic, please report it responsibly.

**Email:** security@mimic.dev

**Do not** file a public GitHub issue for security vulnerabilities. This gives attackers a head start.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### What to expect

- **Acknowledgement** within 24 hours
- **Assessment** within 72 hours
- **Fix timeline** communicated within 1 week
- **Credit** in the security advisory (unless you prefer anonymity)

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | ✅ |
| Latest - 1 minor | ✅ |
| Older | ❌ |

We recommend always running the latest version.

## Security Model

### Mock server

The Mimic mock server is designed for **local development and CI/CD environments**. It is not designed to be exposed to the public internet. If you run `mimic host`, bind it to `localhost` only (the default).

### Data isolation

Mimic generates synthetic data. No real user data, credentials, or PII should ever be seeded through Mimic. The persona blueprint system generates fictional identities, accounts, and transactions.

### Authentication tokens

Mock adapter authentication tokens (e.g., `Bearer mimic_test`) are not real credentials. They exist to simulate auth flows. Never use real API keys with the mock server.

### Blueprint Engine (Pro/Enterprise)

The hosted Blueprint Engine communicates over HTTPS, authenticates via bearer tokens, and does not store generated blueprints server-side beyond the request lifecycle. Enterprise customers running self-hosted deployments control their own data residency.

### Dependencies

We monitor dependencies with automated tools and address critical CVEs within 48 hours. Run `pnpm audit` to check for known vulnerabilities in your local installation.

## Bug Bounty

We don't currently operate a formal bug bounty programme, but we recognise and credit responsible disclosures. Significant findings may receive a thank-you at our discretion.
