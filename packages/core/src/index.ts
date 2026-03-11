// Types
export type {
  SchemaModel,
  TableInfo,
  ColumnInfo,
  ColumnType,
  ForeignKey,
  EnumInfo,
  CollectionModel,
  CollectionInfo,
  FieldType,
  IndexInfo,
} from './types/schema.js';

export type {
  Blueprint,
  PersonaProfile,
  PersonaData,
  EntityData,
  DataPattern,
  RandomSpec,
  FrequencySpec,
  SchemaMapping,
  SchemaMappingEntry,
  TableRole,
  MirrorSource,
  TableClassification,
} from './types/blueprint.js';

export type {
  Adapter,
  AdapterType,
  DatabaseAdapter,
  ApiMockAdapter,
  EventEmitterAdapter,
  AdapterContext,
  AdapterResult,
  DataSpec,
  EndpointDefinition,
  InspectResult,
  HealthCheckResult,
  AdapterManifest,
  PromptContext,
  SemanticType,
  ResourceFieldSpec,
  ResourceSpec,
  AdapterResourceSpecs,
} from './types/adapter.js';

export { MimicConfigSchema } from './types/config.js';
export type { MimicConfig } from './types/config.js';

export type {
  ExpandedData,
  Row,
  DocumentRecord,
  ApiResponseSet,
  ApiResponse,
  GeneratedFile,
  EventRecord,
} from './types/dataset.js';


export type {
  TestScenario,
  TestExpectation,
  TestResult,
  EvaluationDetail,
  TestReport,
} from './types/test.js';

export type {
  Fact,
  FactType,
  FactSeverity,
  FactManifest,
  MimicScenario,
  ScenarioTier,
} from './types/fact-manifest.js';

// Config
export { loadConfig } from './config/index.js';
export {
  DEFAULT_LLM,
  DEFAULT_GENERATE,
  DEFAULT_TEST_MODE,
  DEFAULT_EVALUATOR,
  DEFAULT_SEED_STRATEGY,
} from './config/index.js';

// Utils
export {
  MimicError,
  SchemaParseError,
  BlueprintGenerationError,
  DatabaseConnectionError,
  SeedingError,
  ConfigNotFoundError,
  ConfigInvalidError,
  TestAgentError,
  McpServerError,
  AdapterNotFoundError,
  logger,
} from './utils/index.js';
export type { MimicErrorCode } from './utils/index.js';
export { fileExists, readJson, writeJson, ensureDir } from './utils/index.js';

// Schema
export { topologicalSort } from './schema/topo-sort.js';
export { parsePrismaSchema } from './schema/prisma-parser.js';
export { parseSQLSchema } from './schema/sql-parser.js';
export { introspectDatabase } from './schema/db-introspector.js';
export { introspectMongoDB } from './schema/mongo-introspector.js';
export { parseSchema } from './schema/index.js';

// LLM
export { LLMClient } from './llm/client.js';
export type { LLMClientConfig } from './llm/client.js';
export { CostTracker } from './llm/cost-tracker.js';
export { providerConfigFromMimic } from './llm/providers.js';
export type { ProviderConfig } from './llm/providers.js';

// Generate
export { BlueprintEngine } from './generate/blueprint-engine.js';
export { BlueprintExpander } from './generate/expander.js';
export { BlueprintCache } from './generate/blueprint-cache.js';
export { SeededRandom } from './generate/seed-random.js';
export { DataValidator } from './generate/data-validator.js';
export type { RepairStats } from './generate/data-validator.js';
export { classifyTables } from './generate/table-classifier.js';
export { FkResolutionError, resolveMirroredFks } from './generate/fk-resolver.js';
export { assembleResourceArchetypes } from './generate/resource-assembler.js';
export type { AssembleOptions } from './generate/resource-assembler.js';
export { derivePromptContext, deriveDataSpec } from './types/adapter.js';

// Seed (adapters are now in @mimicai/adapter-* packages)
export { VectorSeeder } from './seed/vector-seeder.js';

// MCP
export { MimicMcpServer } from './mcp/server.js';
export { generateTools } from './mcp/tool-generator.js';
export { QueryBuilder } from './mcp/query-builder.js';

// Test
export { ScenarioRunner } from './test/scenario-runner.js';
export { Evaluator } from './test/evaluator.js';
export { Reporter } from './test/reporter.js';
export { PersonaSimulator } from './test/persona-sim.js';
export { ScenarioGenerator } from './test/scenario-generator.js';
export type { ScenarioExporter } from './test/exporters/exporter.interface.js';
export { PromptFooExporter } from './test/exporters/promptfoo.exporter.js';
export { BraintrustExporter } from './test/exporters/braintrust.exporter.js';
export { LangSmithExporter } from './test/exporters/langsmith.exporter.js';
export { InspectExporter } from './test/exporters/inspect.exporter.js';
export { MimicExporter } from './test/exporters/mimic.exporter.js';

// Mock
export { MockServer } from './mock/server.js';
export { MockRouter } from './mock/router.js';
export { StateStore } from './mock/state-store.js';
export { RequestLogger } from './mock/request-logger.js';
export type { RequestLogEntry } from './mock/request-logger.js';
export { attachMcpTransport, detachMcpTransport } from './mock/mcp-transport.js';
export type { McpTransportConfig } from './mock/mcp-transport.js';
export {
  generateId,
  paginate,
  filterByDate,
  resolvePersonaFromBearer,
  resolvePersonaFromBody,
} from './mock/utils.js';
export type { PaginatedResult } from './mock/utils.js';

// Orchestration
export { Mimic } from './mimic.js';
export type { MimicRunOptions } from './mimic.js';

// Adapter
export { BaseAdapter } from './adapter/base.js';
export {
  AdapterRegistry,
  registerAdapter,
  getAdapter,
  getManifest,
  listAdapters,
} from './adapter/registry.js';
export { loadExternalAdapter } from './adapter/loader.js';
export { registerDefaults } from './adapter/defaults.js';

// Register built-in adapters on import
import { registerDefaults as _registerDefaults } from './adapter/defaults.js';
void _registerDefaults();
