import type { LLMClient } from '../llm/index.js';
import type { TestScenario, PersonaProfile } from '../types/index.js';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const TEXT_SYSTEM_PROMPT = `You are a synthetic user generator. You produce realistic, \
natural-language queries that a real person would type into an AI assistant. \
The query must be a single message — no multi-turn conversation, no markdown, \
no extra commentary. Output ONLY the user query, nothing else.`;

const VOICE_SYSTEM_PROMPT = `You are a synthetic user generator that produces \
realistic SPEECH-TO-TEXT transcriptions. Real speech is messy: include filler words \
(um, uh, like, you know), false starts, self-corrections, incomplete thoughts, \
and casual grammar. The transcription should feel like it came straight from a \
voice assistant — no punctuation beyond what a basic STT engine would produce. \
Output ONLY the transcription, nothing else.`;

function buildUserPrompt(scenario: TestScenario, persona: PersonaProfile): string {
  const lines = [
    `Persona: ${persona.name}, ${persona.age} years old, ${persona.occupation} from ${persona.location}.`,
    persona.description ? `Background: ${persona.description}` : '',
    `Goal: ${scenario.goal}`,
    '',
    'Generate a single user message that this persona would send to achieve the goal.',
  ];
  return lines.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// PersonaSimulator
// ---------------------------------------------------------------------------

/**
 * Generates realistic synthetic user input for test scenarios.
 *
 * Two modes are supported:
 *   - **text**: Clean, typed natural language input.
 *   - **voice**: Messy, speech-to-text style input with fillers and false starts.
 *
 * When a scenario already provides an explicit `input` string, the LLM call is
 * skipped entirely and the provided input is returned as-is.
 */
export class PersonaSimulator {
  private readonly llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }

  /**
   * Generate synthetic user input for a scenario.
   *
   * @param scenario - The test scenario to generate input for.
   * @param persona  - The persona profile that shapes the input style and context.
   * @returns The generated (or pre-defined) user message string.
   */
  async generateInput(
    scenario: TestScenario,
    persona: PersonaProfile,
  ): Promise<string> {
    // If the scenario already provides input, use it verbatim.
    if (scenario.input !== undefined && scenario.input.length > 0) {
      return scenario.input;
    }

    const system =
      scenario.mode === 'voice' ? VOICE_SYSTEM_PROMPT : TEXT_SYSTEM_PROMPT;

    const result = await this.llmClient.generateText({
      system,
      prompt: buildUserPrompt(scenario, persona),
      label: `persona-sim:${scenario.name}`,
      category: 'generation',
      temperature: 0.9,
      maxTokens: 300,
    });

    return result.text.trim();
  }
}
