import { describe, it, expect } from 'vitest';
import { PgSeeder, manifest } from '../index.js';

describe('PgSeeder', () => {
  it('should have correct id and type', () => {
    const seeder = new PgSeeder();
    expect(seeder.id).toBe('postgres');
    expect(seeder.name).toBe('PostgreSQL');
    expect(seeder.type).toBe('database');
  });

  it('should export a valid manifest', () => {
    expect(manifest.id).toBe('postgres');
    expect(manifest.name).toBe('PostgreSQL');
    expect(manifest.type).toBe('database');
    expect(manifest.description).toBeTruthy();
  });
});
