# Licensing

Mimic uses a **dual-license model**. This page explains what that means in plain language.

## The Short Version

| What | License | What you can do |
|------|---------|-----------------|
| CLI, all adapters, adapter SDK, MCP servers, pre-built personas | **Apache 2.0** | Use, modify, distribute, sell, sublicense — do whatever you want. No restrictions beyond standard Apache 2.0 terms. |
| Blueprint Engine, advanced test runner, dashboard, enterprise features | **Elastic License v2** | Use freely. Modify freely. Cannot offer as a managed/hosted service to third parties. Cannot circumvent license keys. |

## Why This Split?

The open-source components (CLI, adapters, SDK) are the surface area developers touch every day. We want zero friction for adoption, contribution, and redistribution. Apache 2.0 ensures that.

The proprietary components (Blueprint Engine, cross-surface consistency engine) represent Mimic's core differentiator — the intelligence that generates coherent synthetic data across multiple surfaces. Elastic License v2 protects this from being extracted and offered as a competing hosted service while keeping the source code fully visible and inspectable.

This is the same model used by Elastic (Elasticsearch), dbt Labs (dbt), and Apollo GraphQL (Apollo Federation).

## What Elastic License v2 Allows

ELv2 has exactly three restrictions. Everything else is permitted.

**You cannot:**
1. Provide the ELv2-licensed software to others as a managed service (i.e., you can't build "Mimic Cloud" and sell access to the Blueprint Engine)
2. Circumvent the license key functionality or any licensing-related features
3. Remove or obscure licensing notices

**You can:**
- Use Mimic (including ELv2 components) internally at your company, for free, without limits
- Modify ELv2 source code for your own use
- Read, learn from, and audit the ELv2 source code
- Build and sell products that use Mimic as a development/testing tool
- Run Mimic in CI/CD pipelines
- Distribute modifications to your own team

## File-Level Clarity

Every source file declares its license in a header comment:

```typescript
// Apache 2.0 files:
// Copyright 2026 Mimic Data Ltd.
// Licensed under the Apache License, Version 2.0.

// ELv2 files:
// Copyright 2026 Mimic Data Ltd.
// Licensed under the Elastic License v2 (ELv2).
// See LICENSE-ELv2 in the repository root.
```

The directory structure makes the split obvious:

```
packages/
  oss/          ← Everything here is Apache 2.0
  commercial/   ← Everything here is ELv2
```

## Community Contributions

- Contributions to `packages/oss/` are Apache 2.0. You retain copyright, and grant Mimic a license to distribute under Apache 2.0 terms via the CLA.
- Contributions to `packages/commercial/` are ELv2. Same CLA, different license.
- Community-contributed adapters are **always Apache 2.0**, regardless of where they live. This will never change.

## Frequently Asked Questions

**Can I use Mimic at my company for free?**
Yes. The free tier includes the full CLI, all adapters, all MCP servers, and pre-built personas. You can use these commercially without restriction.

**Can I fork Mimic and build my own adapters?**
Yes. The adapter SDK and all adapters are Apache 2.0. Fork away.

**Can I include Mimic adapters in my own open-source project?**
Yes. Apache 2.0 permits this. Just include the license notice.

**Can I run the Blueprint Engine on my own servers?**
Yes, with an Enterprise license. Self-hosted deployment is an Enterprise feature.

**Can I build a hosted "Mimic as a Service" product?**
No. This is the one thing ELv2 prohibits. If you want to offer Mimic as a managed service, contact us about a partnership or reseller agreement.

**Will the open-source components ever become proprietary?**
No. See our [Open Source Charter](OPEN_SOURCE_CHARTER.md) for binding commitments.

## License Texts

- [Apache License 2.0](LICENSE-APACHE-2.0)
- [Elastic License v2](LICENSE-ELv2)

## Questions

If you're unsure whether your use case is permitted, email legal@mimic.dev. We respond within 48 hours and err on the side of permissiveness.
