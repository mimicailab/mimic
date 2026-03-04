---
"@mimicai/core": minor
---

feat: add API mock adapter framework and unified MCP tool registration

- Add `ApiMockAdapter` interface with optional `registerMcpTools()` method for
  exposing adapter tools through the unified MCP server
- Add `registerExternalTools()` to `MimicMcpServer` allowing adapters to register
  tools alongside database tools in a single MCP connection
- Support API-only mode in MimicMcpServer (optional schema/pool params)
- Extend blueprint schema with `apiEntities` and `apiEntityArchetypes` for
  generating Stripe-compatible mock data (customers, subscriptions, invoices,
  payment intents, products, prices)
- Add `@faker-js/faker` for realistic field generation in API entity expansion
- Expand `BlueprintExpander` to handle API response generation from archetypes
  with support for recurring patterns, event-based generation, and field templates
- Update LLM prompts to generate API entity definitions in blueprints
