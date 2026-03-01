import type {
  Adapter,
  AdapterType,
  AdapterContext,
  AdapterResult,
} from '../types/adapter.js';
import type { ExpandedData } from '../types/dataset.js';

export abstract class BaseAdapter<TConfig = unknown> implements Adapter<TConfig> {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly type: AdapterType;
  readonly versions?: string[];

  protected config?: TConfig;
  protected context?: AdapterContext;

  async init(config: TConfig, context: AdapterContext): Promise<void> {
    this.config = config;
    this.context = context;
  }

  abstract apply(
    data: ExpandedData,
    context: AdapterContext,
  ): Promise<AdapterResult>;

  abstract clean(context: AdapterContext): Promise<void>;

  async healthcheck(_context: AdapterContext): Promise<boolean> {
    return true;
  }

  async dispose(): Promise<void> {
    this.config = undefined;
    this.context = undefined;
  }
}
