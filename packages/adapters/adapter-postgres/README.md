# @mimicai/adapter-postgres

PostgreSQL database adapter for [Mimic](https://github.com/mimicailab/mimic) — seeds tables with persona-consistent data using FK-aware ordering, batch INSERT, and COPY.

## Install

```bash
npm install @mimicai/adapter-postgres
```

## Features

- FK-aware table ordering for referential integrity
- Batch INSERT for small datasets (<500 rows)
- COPY FROM STDIN for high-volume seeding (>=500 rows)
- Automatic sequence synchronization after seeding
- Atomic transactions — all-or-nothing seeding

## Usage

Used automatically by `mimic seed` when configured in `mimic.json`:

```json
{
  "databases": [
    {
      "adapter": "postgres",
      "connectionString": "postgresql://localhost:5432/testdb"
    }
  ]
}
```

## License

[Apache 2.0](../../../LICENSE-APACHE-2.0)
