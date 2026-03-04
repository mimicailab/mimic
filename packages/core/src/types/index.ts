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
} from './adapter.js';

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
