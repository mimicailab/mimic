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
export { loadConfig, resolveConfigEnvVar } from './config/index.js';
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
export type { ILLMClient, LLMClientConfig } from './llm/client.js';
export { ClaudeCodeClient } from './llm/claude-code-client.js';
export type { ClaudeCodeClientConfig } from './llm/claude-code-client.js';
export { createLLMClient } from './llm/factory.js';
export { CostTracker } from './llm/cost-tracker.js';
export type { LLMRuntime, TokenUsageEntry, CostSummary, CostCategory } from './llm/cost-tracker.js';
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
export { generateFacts, buildDataStats } from './generate/fact-generator.js';
export { auditClaims, formatAuditFailures } from './generate/claim-auditor.js';
export { applyBlueprintPatch } from './generate/blueprint-patch.js';
export { expandAndAudit } from './generate/audit-and-repair.js';
export type { ExpandAndAuditOptions, ExpandAndAuditResult } from './generate/audit-and-repair.js';
export { rewriteBridgeTables, rewriteClaimsForBridges, formatBridgeRewrite } from './generate/bridge-rewriter.js';
export type { BridgeRewriteResult } from './generate/bridge-rewriter.js';
export { solveCounts, formatConflicts } from './generate/count-solver.js';
export type { SolveResult, SolverConflict, SolverTraceEntry } from './generate/count-solver.js';
export { deterministicRepair, formatRepairDecisions } from './generate/deterministic-repair.js';
export type { DeterministicRepairResult, RepairDecision } from './generate/deterministic-repair.js';

// V2 — layered, narrow-LLM pipeline (claim-extract → bridge-rewrite → topology → per-slot content)
export { extractClaims } from './generate/claim-extractor.js';
export type { ExtractClaimsOptions, ExtractClaimsResult } from './generate/claim-extractor.js';

// V4.5 — Contract compiler → coverage planner → lowering → V2/V3 core → fidelity validator
export {
  compileContract,
  CONTRACT_COMPILER_VERSION,
} from './contract/contract-compiler.js';
export type { CompileContractOptions } from './contract/contract-compiler.js';
export {
  planCoverage,
  formatCoverageReport,
  CAPABILITY_REGISTRY_VERSION,
  LOWERING_TARGETS,
  HELPER_TARGETS,
} from './contract/coverage-planner.js';
export { lowerContract, formatLoweringResult } from './contract/lowering.js';
export type { LoweringResult } from './contract/lowering.js';
export type {
  PersonaContract,
  CoverageStatus,
  CoverageDecision,
  CoverageReport,
} from './contract/persona-contract.js';
export type {
  Clause,
  ClauseFamily,
  ClauseStrength,
  ClauseId,
  CountClause,
  AggregateClause,
  DistributionClause,
  TemporalClause,
  AnchorClause,
  CrossSurfaceClause,
  ReconciliationClause,
  NarrativeClause,
} from './contract/clause-types.js';
export {
  runFidelity,
  formatFidelityFailures,
} from './validation/fidelity-validator.js';
export type {
  FidelityResult,
  FidelityEvaluation,
  FidelityFailureSource,
} from './validation/fidelity-validator.js';
export { readV45Annotations } from './generate/blueprint-engine.js';
export { deriveSlots } from './generate/topology.js';
export type { ResourceSlot, DeriveSlotsOptions } from './generate/topology.js';
export { generateAllSlots } from './generate/content-generator.js';
export type {
  GenerateSlotContentOptions,
  SlotContentResult,
} from './generate/content-generator.js';
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
export { ClaudeSkillExporter } from './test/exporters/claude-skill.exporter.js';
export type { ClaudeSkillExporterOptions } from './test/exporters/claude-skill.exporter.js';

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
