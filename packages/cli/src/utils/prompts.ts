import { select, confirm, input } from '@inquirer/prompts';

export { select, confirm, input };

/**
 * Prompt user to select a domain (e.g. "personal finance", "calendar", "support").
 */
export async function promptDomain(): Promise<string> {
  return select({
    message: 'What domain are you building for?',
    choices: [
      { name: 'Personal Finance', value: 'personal finance' },
      { name: 'Calendar / Scheduling', value: 'calendar' },
      { name: 'Customer Support', value: 'support' },
      { name: 'E-Commerce', value: 'ecommerce' },
      { name: 'Healthcare', value: 'healthcare' },
      { name: 'Other', value: 'other' },
    ],
  });
}

/**
 * Prompt user to select an LLM provider.
 */
export async function promptProvider(): Promise<string> {
  return select({
    message: 'Which LLM provider do you want to use?',
    choices: [
      { name: 'Anthropic (Claude)', value: 'anthropic' },
      { name: 'OpenAI (GPT)', value: 'openai' },
      { name: 'Google (Gemini)', value: 'google' },
    ],
  });
}

/**
 * Prompt user for a yes/no confirmation.
 */
export async function promptConfirm(message: string): Promise<boolean> {
  return confirm({ message });
}
