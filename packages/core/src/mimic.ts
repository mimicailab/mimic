import type { MimicConfig } from './types/config.js';
import type { SchemaModel } from './types/schema.js';
import type { Blueprint } from './types/blueprint.js';
import type { ExpandedData } from './types/dataset.js';
import { parseSchema, type ParseSchemaOptions } from './schema/index.js';
import { BlueprintEngine } from './generate/blueprint-engine.js';
import { BlueprintExpander } from './generate/expander.js';
import { BlueprintCache } from './generate/blueprint-cache.js';
import { LLMClient } from './llm/client.js';
import { CostTracker } from './llm/cost-tracker.js';
// PgSeeder loaded dynamically from @mimicai/adapter-postgres
import { AdapterRegistry } from './adapter/registry.js';
import { MockServer } from './mock/server.js';
import { logger } from './utils/logger.js';

export interface MimicRunOptions {
  /** Schema parsing options (schema source, pool, base path) */
  schemaOptions?: ParseSchemaOptions;
  /** Skip database seeding */
  skipSeed?: boolean;
  /** Start mock API server after seeding */
  startMockServer?: boolean;
  /** Port for mock API server */
  mockServerPort?: number;
}

/**
 * Top-level orchestrator for the Mimic pipeline.
 *
 * Usage:
 * ```ts
 * const mimic = new Mimic(config);
 * await mimic.run({ schemaOptions: { schema: { source: 'prisma' } } });
 * ```
 */
export class Mimic {
  private config: MimicConfig;
  private costTracker: CostTracker;
  private adapterRegistry: AdapterRegistry;

  constructor(config: MimicConfig) {
    this.config = config;
    this.costTracker = new CostTracker();
    this.adapterRegistry = new AdapterRegistry();
  }

  /**
   * Run the full Mimic pipeline:
   * 1. Parse schema
   * 2. Generate blueprints
   * 3. Expand blueprints into rows
   * 4. Seed databases
   * 5. Optionally start mock server
   */
  async run(options: MimicRunOptions = {}): Promise<{
    schema: SchemaModel;
    blueprints: Blueprint[];
    data: Map<string, ExpandedData>;
  }> {
    logger.header('mimic run');

    // 1. Parse schema
    logger.step('Parsing schema...');
    const schemaOpts: ParseSchemaOptions = options.schemaOptions ?? {};
    const schema = await parseSchema(schemaOpts);

    // 2. Generate blueprints
    logger.step('Generating blueprints...');
    const llm = new LLMClient(this.config.llm, this.costTracker);
    const cache = new BlueprintCache('.mimic/blueprints');
    const engine = new BlueprintEngine(llm, cache, this.costTracker);
    const blueprints: Blueprint[] = [];

    for (const persona of this.config.personas) {
      const blueprint = await engine.generate(
        schema,
        persona,
        this.config.domain,
      );
      blueprints.push(blueprint);
    }

    // 3. Expand blueprints into rows
    logger.step('Expanding blueprints...');
    const data = new Map<string, ExpandedData>();
    const seed = this.config.generate.seed;
    for (const blueprint of blueprints) {
      const expander = new BlueprintExpander(seed);
      const expanded = expander.expand(blueprint, schema, this.config.generate.volume);
      data.set(blueprint.personaId, expanded);
    }

    // 4. Seed databases
    if (!options.skipSeed && this.config.databases) {
      logger.step('Seeding databases...');
      const dbEntries = Object.entries(this.config.databases);
      for (const [name, dbConfig] of dbEntries) {
        if (dbConfig.type === 'postgres') {
          try {
            const pkg = '@mimicai/adapter-postgres';
            const { PgSeeder } = await import(/* @vite-ignore */ pkg);
            const seeder = new PgSeeder(dbConfig.url);
            await seeder.seedBatch(schema, data, {
              strategy: dbConfig.seedStrategy ?? 'truncate-and-insert',
            });
            await seeder.disconnect();
            logger.success(`Seeded database: ${name}`);
          } catch {
            logger.warn(`@mimicai/adapter-postgres not installed — skipping ${name}`);
          }
        } else {
          logger.warn(`Seeder for ${dbConfig.type} not yet implemented in orchestrator — use 'mimic seed' CLI instead`);
        }
      }
    }

    // 5. Optionally start mock server
    if (options.startMockServer) {
      logger.step('Starting mock server...');
      const mockServer = new MockServer();
      const port = options.mockServerPort ?? 4100;
      await mockServer.start(port);
    }

    // Summary
    logger.header('Summary');
    logger.info(`Tables: ${schema.tables.length}`);
    logger.info(`Personas: ${blueprints.length}`);
    let totalRows = 0;
    for (const expanded of data.values()) {
      totalRows += Object.values(expanded.tables).reduce(
        (sum, rows) => sum + rows.length,
        0,
      );
    }
    logger.info(`Total rows: ${totalRows}`);
    const summary = this.costTracker.getSummary();
    if (summary.total > 0) {
      logger.info(`LLM cost: $${summary.total.toFixed(4)}`);
    }

    return { schema, blueprints, data };
  }

  /** Get the cost tracker instance for inspection */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  /** Get the adapter registry */
  getAdapterRegistry(): AdapterRegistry {
    return this.adapterRegistry;
  }
}
