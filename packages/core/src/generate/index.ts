export { BlueprintEngine } from './blueprint-engine.js';
export type { GenerateOptions, PersonaInput } from './blueprint-engine.js';

export { BlueprintCache } from './blueprint-cache.js';

export { BlueprintExpander, parseVolume } from './expander.js';

export { SeededRandom } from './seed-random.js';

export { buildPrompt, buildClaimExtractionPrompt, buildContentPrompt } from './prompts.js';
export type {
  PromptPair,
  BuildPromptOptions,
  BuildClaimExtractionPromptOptions,
  BuildContentPromptOptions,
  SlotPromptClaim,
  SlotPromptAnchor,
  IdentityContractEntry,
} from './prompts.js';

export {
  BlueprintSchema,
  BlueprintLLMOutputSchema,
  ClaimExtractionOutputSchema,
  DbSlotContentOutputSchema,
  ApiSlotContentOutputSchema,
} from './blueprint-zod.js';
export type {
  BlueprintLLMOutput,
  ClaimExtractionOutput,
  DbSlotContentOutput,
  ApiSlotContentOutput,
} from './blueprint-zod.js';

// V2 pipeline modules
export { extractClaims } from './claim-extractor.js';
export type { ExtractClaimsOptions, ExtractClaimsResult } from './claim-extractor.js';
export { deriveSlots } from './topology.js';
export type { ResourceSlot, DeriveSlotsOptions } from './topology.js';
export { generateAllSlots } from './content-generator.js';
export type {
  GenerateSlotContentOptions,
  SlotContentResult,
} from './content-generator.js';
export { rewriteClaimsForBridges } from './bridge-rewriter.js';

export { classifyTables } from './table-classifier.js';
export type { ClassifyTablesOptions } from './table-classifier.js';

export { FkResolutionError, resolveMirroredFks } from './fk-resolver.js';
export type { FkResolutionContext, FkResolutionResult } from './fk-resolver.js';

export { assembleResourceArchetypes } from './resource-assembler.js';
export type { ResourceDistribution, DistributionOutput } from './resource-assembler.js';

export { generateFacts, buildDataStats } from './fact-generator.js';
export type { DataStats } from './fact-generator.js';
