# @mimicai/adapter-sdk

SDK for building custom [Mimic](https://github.com/mimicailab/mimic) API mock adapters — base class, test helpers, and shared utilities.

## Install

```bash
npm install @mimicai/adapter-sdk
```

## Usage

Create a new adapter by extending `BaseApiMockAdapter`:

```typescript
import { BaseApiMockAdapter } from '@mimicai/adapter-sdk';

export class MyServiceAdapter extends BaseApiMockAdapter {
  name = 'my-service';

  buildRoutes() {
    return [
      {
        method: 'GET',
        path: '/api/items',
        handler: (req) => this.handleListItems(req),
      },
    ];
  }
}
```

## Test helpers

The SDK includes test utilities for verifying your adapter:

```typescript
import { createTestAdapter } from '@mimicai/adapter-sdk';

const adapter = createTestAdapter(MyServiceAdapter);
const response = await adapter.request('GET', '/api/items');
```

## See also

- [Adapter Development Guide](../../docs/ADAPTER_GUIDE.md)
- [Existing adapters](../adapters/) for reference implementations

## License

[Apache 2.0](../../LICENSE-APACHE-2.0)
