---
name: mimic-eval
description: Run Mimic-generated eval scenarios against a target agent skill (default `briefing-prep`) inside this Claude Code session. Reads `.mimic/exports/mimic-scenarios.json`, sub-agents one run per scenario via the Agent tool, scores responses with hybrid (strict substring + LLM-judge-on-miss + numeric-range) checks, and prints a scored table. Use when the user says any of "run the mimic eval", "score the briefing agent", "eval the brief against the facts", "/mimic-eval".
---

# Mimic eval runner

You are the orchestrator of an eval loop that grades a target agent skill against ground-truth scenarios derived from a Mimic fact manifest. Each scenario carries an input prompt and a list of substrings the agent's response must surface.

## Inputs you'll need

- **Scenarios file** — default `.mimic/exports/mimic-scenarios.json`. If missing, run `mimic test --export mimic` via Bash first (requires `test:` block in `mimic.json` with at least an `agent` URL; the URL isn't hit by this skill but the schema demands it).
- **Target skill** — default `briefing-prep`. Override only if the user names a different one.

## Step 1 — load and summarise scenarios

Read the scenarios file. Each entry is:

```json
{
  "name": "...",
  "input": "<prompt to send the agent>",
  "expect": {
    "response_contains": ["str1", "str2", ...],
    "numeric_range": { "field": "...", "min": N, "max": N }
  },
  "metadata": { "tier": "smoke|functional|adversarial", "platform": "...", "source_fact": "fact_NNN" }
}
```

Print a one-liner: "Loaded N scenarios across <tiers> from <path>."

## Step 2 — run each scenario as a sub-agent

For EVERY scenario, spawn a sub-agent via the Agent tool. Run them in parallel batches of 3 — send 3 Agent tool calls in one assistant message, wait for all three results, then send the next batch. This keeps wall-clock time bounded without overwhelming MCP servers.

Sub-agent invocation:

```
Agent({
  description: "Eval run: <scenario.name>",
  subagent_type: "general-purpose",
  prompt: <PROMPT_TEMPLATE>
})
```

Where `<PROMPT_TEMPLATE>` is:

```
You are the briefing agent under test in a Mimic eval. Produce a one-screen pre-call briefing exactly as the briefing-prep skill prescribes. The skill markdown lives at `examples/briefing-agent/skills/briefing-prep/SKILL.md` (relative to repo root); read it first to learn the steps and the brief format.

You have access to MCP tools for `mimic-attio`, `mimic-hubspot`, `mimic-granola`, `mimic-gmail`, `mimic-slack`, and `mimic-postgres` — fan out across them per the skill's instructions.

User request:
<scenario.input>

Output ONLY the rendered brief text (no preamble, no explanation, no tool-call narration). The eval grader will read the brief verbatim.
```

Capture each sub-agent's returned text as `response[scenario.name]`.

## Step 3 — score deterministically (strict pass)

For each scenario, for each substring in `expect.response_contains`:

- Lowercase both response and substring.
- If `response.lower().includes(substring.lower())` → mark `satisfied`.
- Else → mark `candidate-miss` (do NOT mark `missed` yet — needs semantic fallback in step 4).

For each `expect.numeric_range`:

- Regex-extract every number from the response: `/[-+]?\d{1,3}(,\d{3})*(\.\d+)?|[-+]?\d+(\.\d+)?/g`. Strip commas before parsing.
- If ANY extracted number falls within `[min, max]` → satisfied. Else → candidate-miss (numeric ranges DO NOT get a semantic fallback — they're either in range or not).

## Step 4 — semantic fallback on `candidate-miss` (LLM-judge, one call per scenario)

For each scenario that has at least one `candidate-miss` substring (skip those with all-strict-pass to save cost), run ONE LLM-as-judge check:

Compose this prompt and send it to yourself via... actually no — the orchestrator (you) IS the LLM. Just reason inline:

> Read the response text and the candidate-miss substrings. For each substring, decide: does the response convey the same fact via paraphrase, synonym, or value-equivalent rewording (e.g. "£240k" vs "£240,000", "VP Engineering" vs "VP of Engineering", "Procurement stage" vs "in procurement")? Only mark `satisfied-by-paraphrase` if the meaning is preserved. Otherwise mark `missed`.

Don't invoke another sub-agent for this — keep it in your own context. Be conservative: paraphrase yes, hallucinated/inferred-not-stated no.

## Step 5 — pass/fail per scenario

A scenario `passes` if `(satisfied + satisfied-by-paraphrase) / total ≥ 0.8` AND every `numeric_range` (if any) is satisfied. Otherwise `fails`.

## Step 6 — print the report

Output a single fenced markdown block with this exact structure:

```
## Mimic Eval Report

**Run:** <ISO-8601 timestamp>
**Scenarios:** <total>  |  **Passed:** <P>  |  **Failed:** <F>  |  **Pass rate:** <PP%>

| # | Scenario | Tier | Strict | Paraphrase | Numeric | Result |
|---|---|---|---|---|---|---|
| 1 | <name> | smoke | 5/7 | 1/2 | ✓ | ✅ pass |
| 2 | <name> | functional | 2/6 | 0/4 | ✗ | ❌ fail |
| ... | | | | | | |

### By tier
- smoke:        <pass>/<total> (<%>)
- functional:   <pass>/<total> (<%>)
- adversarial:  <pass>/<total> (<%>)

### Failures
For each failed scenario, list:
- **<name>** — strict-missed: ["str_x", "str_y"] | paraphrase-missed: ["str_z"] | numeric-out-of-range: <field>=<value> (expected [min, max])
- (truncate response to first 600 chars if useful)
```

After the report, surface a one-line conclusion: which tier did worst, and which fact ids ([source_fact]) the agent struggled with most.

## Critical rules

- **Read-only.** The skill never writes, posts, sends, or otherwise mutates anything. Skill steps that suggest actions are eval steps only.
- **No interleaved chat.** While running, do not narrate "Now grading scenario 4..." — it pollutes output. Print only the final report (you may emit a single one-line progress hint between batches like "Batch 2 of 4 complete" if the user asked for verbose).
- **Agent tool failures** — if a sub-agent errors out, mark that scenario `error` (not pass/fail) and include the error in Failures. Continue with the rest.
- **Cost awareness** — 10 scenarios × one full sub-agent = a real bill. If the user asks for the eval and there are >20 scenarios, confirm before spawning.
- **Determinism** — run the same eval twice and the substring/numeric checks produce the same verdict. The semantic-fallback step is the only non-deterministic part; keep it conservative.
- **The target skill is configurable** — if the user says "eval against the deal-context skill" or "use my custom briefing-v2 skill", swap the path in the sub-agent prompt template accordingly. Default is `briefing-prep`.

## Example invocation

User: "run the mimic eval"

You should:
1. Bash `ls .mimic/exports/mimic-scenarios.json` to confirm it exists (or run `mimic test --export mimic` to create it).
2. Read it, summarise count + tiers.
3. Spawn sub-agents in batches of 3.
4. Score, paraphrase-fallback, print the report.
5. Stop.

That's the whole loop.
