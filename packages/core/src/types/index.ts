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
} from './schema.js';

export type {
  Blueprint,
  PersonaProfile,
  PersonaData,
  EntityData,
  DataPattern,
  RandomSpec,
  FrequencySpec,
  FieldVariation,
  EntityArchetype,
  EntityArchetypeConfig,
  SchemaMapping,
  SchemaMappingEntry,
  TableRole,
  MirrorSource,
  TableClassification,
} from './blueprint.js';

export type {
  Adapter,
  AdapterType,
  DatabaseAdapter,
  ApiMockAdapter,
  EventEmitterAdapter,
  AdapterContext,
  AdapterResult,
  EndpointDefinition,
  InspectResult,
  HealthCheckResult,
  AdapterManifest,
  PromptContext,
  DataSpec,
  SemanticType,
  ResourceFieldSpec,
  ResourceSpec,
  AdapterResourceSpecs,
} from './adapter.js';

export { derivePromptContext, deriveDataSpec } from './adapter.js';

export { MimicConfigSchema } from './config.js';
export type { MimicConfig } from './config.js';

export type {
  ExpandedData,
  Row,
  DocumentRecord,
  ApiResponseSet,
  ApiResponse,
  GeneratedFile,
  EventRecord,
} from './dataset.js';

export type {
  TestScenario,
  TestExpectation,
  TestResult,
  EvaluationDetail,
  TestReport,
} from './test.js';
