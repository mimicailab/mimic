#!/usr/bin/env node

import { runExploreDaemon } from '../src/commands/explore.js';
import { run } from '../src/index.js';

// Background daemon spawned by `mimic explore` — start explorer server and stay alive.
if (process.env.MIMIC_EXPLORE_DAEMON === '1') {
  await runExploreDaemon();
} else {
  await run();
}
