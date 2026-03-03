export type MimicErrorCode =
  | 'SCHEMA_PARSE_ERROR'
  | 'BLUEPRINT_GEN_ERROR'
  | 'DB_CONNECTION_ERROR'
  | 'SEEDING_ERROR'
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'TEST_AGENT_ERROR'
  | 'MCP_SERVER_ERROR'
  | 'ADAPTER_NOT_FOUND';

export class MimicError extends Error {
  constructor(
    message: string,
    public readonly code: MimicErrorCode,
    public readonly hint?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'MimicError';
  }

  format(): string {
    const lines = [
      `Error [${this.code}]: ${this.message}`,
    ];
    if (this.hint) {
      lines.push(`  Hint: ${this.hint}`);
    }
    if (this.cause) {
      lines.push(`  Cause: ${this.cause.message}`);
    }
    return lines.join('\n');
  }
}

export class SchemaParseError extends MimicError {
  constructor(message: string, hint?: string, cause?: Error, public readonly source?: string) {
    super(message, 'SCHEMA_PARSE_ERROR', hint ?? (source ? `Check your ${source} schema for syntax errors` : 'Check your schema file for syntax errors'), cause);
    this.name = 'SchemaParseError';
  }
}

export class BlueprintGenerationError extends MimicError {
  constructor(message: string, hint?: string, cause?: Error, public readonly persona?: string) {
    super(message, 'BLUEPRINT_GEN_ERROR', hint ?? 'Try --generate to regenerate the blueprint', cause);
    this.name = 'BlueprintGenerationError';
  }
}

export class DatabaseConnectionError extends MimicError {
  constructor(message: string, hint?: string, cause?: Error, public readonly url?: string) {
    super(message, 'DB_CONNECTION_ERROR', hint ?? 'Check DATABASE_URL and ensure PostgreSQL is running', cause);
    this.name = 'DatabaseConnectionError';
  }
}

export class SeedingError extends MimicError {
  constructor(message: string, hint?: string, cause?: Error, public readonly table?: string) {
    super(message, 'SEEDING_ERROR', hint ?? (table ? `Check FK constraints and data types for table "${table}"` : 'Check FK constraints and data types'), cause);
    this.name = 'SeedingError';
  }
}

export class AdapterNotFoundError extends MimicError {
  constructor(adapterId: string) {
    super(
      `Adapter "${adapterId}" not found`,
      'ADAPTER_NOT_FOUND',
      `Install it: pnpm add @mimicai/adapter-${adapterId}`,
    );
    this.name = 'AdapterNotFoundError';
  }
}

export class ConfigNotFoundError extends MimicError {
  constructor(path?: string) {
    super(
      `Configuration file not found${path ? ` at ${path}` : ''}`,
      'CONFIG_NOT_FOUND',
      "Run 'mimic init' to create a mimic.json configuration file",
    );
    this.name = 'ConfigNotFoundError';
  }
}

export class ConfigInvalidError extends MimicError {
  constructor(message: string, hint?: string) {
    super(message, 'CONFIG_INVALID', hint);
    this.name = 'ConfigInvalidError';
  }
}

export class TestAgentError extends MimicError {
  constructor(message: string, url?: string, cause?: Error) {
    super(
      message,
      'TEST_AGENT_ERROR',
      url ? `Check that the agent is running at ${url}` : 'Check that the agent is running',
      cause,
    );
    this.name = 'TestAgentError';
  }
}

export class McpServerError extends MimicError {
  constructor(message: string, hint?: string, cause?: Error) {
    super(
      message,
      'MCP_SERVER_ERROR',
      hint ?? 'Check DATABASE_URL and ensure PostgreSQL is running',
      cause,
    );
    this.name = 'McpServerError';
  }
}
