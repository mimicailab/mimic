import type { MimicScenario } from '../../types/fact-manifest.js';

/**
 * Interface for exporting MimicScenarios to external eval platform formats.
 */
export interface ScenarioExporter {
  /** Identifier for this export format, e.g. "promptfoo", "braintrust" */
  readonly format: string;

  /**
   * Export scenarios to the target format, writing files to outputDir.
   * Returns the list of file paths written.
   */
  export(scenarios: MimicScenario[], outputDir: string): Promise<string[]>;
}
