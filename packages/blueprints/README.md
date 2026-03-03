# @mimicai/blueprints

Pre-built persona blueprints for [Mimic](https://github.com/mimicailab/mimic) — ready-to-use synthetic data profiles for AI agent testing.

## Install

```bash
npm install @mimicai/blueprints
```

## Available blueprints

| Blueprint | Description |
|-----------|-------------|
| `young-professional` | 28yo software engineer, moderate income, active banking |
| `freelancer` | Self-employed designer, variable income, multiple clients |
| `college-student` | 21yo student, limited finances, part-time work |

## Usage

```typescript
import { blueprints } from '@mimicai/blueprints';

const persona = blueprints['young-professional'];
```

Or use via the CLI — blueprints are referenced by name in `mimic.json`:

```json
{
  "personas": [{ "name": "alex", "blueprint": "young-professional" }]
}
```

## License

[Apache 2.0](../../LICENSE-APACHE-2.0)
