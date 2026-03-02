import { z } from 'zod';

export const MimicConfigSchema = z.object({
  $schema: z.string().optional(),
  domain: z.string().describe('What does this agent do?'),

  llm: z
    .object({
      provider: z.enum(['anthropic', 'openai', 'ollama', 'custom']),
      model: z.string(),
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
    })
    .default({ provider: 'anthropic', model: 'claude-haiku-4-5' }),

  personas: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z0-9-]+$/),
        description: z.string(),
        blueprint: z.string().optional(),
      }),
    )
    .min(1),

  generate: z
    .object({
      volume: z.string().default('6 months'),
      seed: z.number().int().default(42),
      tables: z
        .record(z.union([z.number(), z.literal('auto')]))
        .optional(),
    })
    .default({}),

  databases: z
    .record(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('postgres'),
          url: z.string(),
          schema: z
            .object({
              source: z.enum(['prisma', 'sql', 'introspect']),
              path: z.string().optional(),
            })
            .optional(),
          seedStrategy: z
            .enum(['truncate-and-insert', 'append', 'upsert'])
            .default('truncate-and-insert'),
        }),
        z.object({
          type: z.literal('mysql'),
          url: z.string(),
          schema: z
            .object({
              source: z.enum(['sql', 'introspect']),
              path: z.string().optional(),
            })
            .optional(),
          seedStrategy: z
            .enum(['truncate-and-insert', 'append', 'upsert'])
            .default('truncate-and-insert'),
          pool: z
            .object({
              max: z.number().default(5),
              timeout: z.number().default(5000),
            })
            .optional(),
          copyThreshold: z.number().default(500),
          excludeTables: z.array(z.string()).optional(),
        }),
        z.object({
          type: z.literal('sqlite'),
          path: z.string(),
          walMode: z.boolean().optional(),
          seedStrategy: z
            .enum(['truncate-and-insert', 'append'])
            .default('truncate-and-insert'),
        }),
        z.object({
          type: z.literal('mongodb'),
          url: z.string(),
          database: z.string().optional(),
          collections: z.array(z.string()).optional(),
          seedStrategy: z
            .enum(['drop-and-insert', 'delete-and-insert', 'append', 'upsert'])
            .default('delete-and-insert'),
          autoCreateIndexes: z.boolean().optional(),
          tls: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('vector'),
          provider: z.enum(['pinecone', 'weaviate', 'chroma', 'pgvector']),
          config: z.record(z.unknown()),
          embeddingModel: z.string().optional(),
          documentSource: z.object({
            type: z.enum(['generate', 'directory']),
            description: z.string().optional(),
            path: z.string().optional(),
            count: z.number().optional(),
          }),
        }),
        z.object({
          type: z.literal('redis'),
          url: z.string(),
        }),
      ]),
    )
    .optional(),

  apis: z
    .record(
      z.object({
        adapter: z.string().optional(),
        version: z.string().optional(),
        port: z.number().optional(),
        config: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),

  files: z
    .record(
      z.object({
        type: z.enum(['s3', 'local', 'gcs']),
        path: z.string(),
        generate: z.object({
          types: z.array(
            z.enum(['pdf', 'csv', 'xlsx', 'json', 'txt', 'image-metadata']),
          ),
          count: z.number(),
          description: z.string(),
        }),
      }),
    )
    .optional(),

  events: z
    .record(
      z.object({
        type: z.enum(['kafka', 'webhook', 'sqs']),
        config: z.record(z.unknown()),
        topics: z.array(z.string()).optional(),
      }),
    )
    .optional(),

  test: z
    .object({
      agent: z.string().url(),
      mode: z.enum(['text', 'voice']).default('text'),
      evaluator: z.enum(['keyword', 'llm', 'both']).default('both'),
      scenarios: z
        .array(
          z.union([
            z.string(),
            z.object({
              name: z.string(),
              persona: z.string().optional(),
              goal: z.string(),
              input: z.string().optional(),
              expect: z
                .object({
                  tools_called: z.array(z.string()).optional(),
                  response_contains: z.array(z.string()).optional(),
                  response_accurate: z.boolean().optional(),
                  no_hallucination: z.boolean().optional(),
                  confirms_before_action: z.boolean().optional(),
                  max_latency_ms: z.number().optional(),
                  custom: z.record(z.unknown()).optional(),
                })
                .optional(),
            }),
          ]),
        )
        .optional(),
    })
    .optional(),
});

export type MimicConfig = z.infer<typeof MimicConfigSchema>;
