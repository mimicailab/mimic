import chalk from 'chalk';
import type { TestReport, TestResult, EvaluationDetail } from '../types/index.js';

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

/**
 * Formats a {@link TestReport} for human or machine consumption.
 *
 * Three output formats:
 *   - **CLI**: Colored terminal output with pass/fail indicators.
 *   - **JSON**: The full `TestReport` object serialized as JSON.
 *   - **JUnit**: XML compatible with GitHub Actions, Jenkins, and other CI tools.
 */
export class Reporter {
  // -----------------------------------------------------------------------
  // CLI format
  // -----------------------------------------------------------------------

  /**
   * Produce a human-readable, colored CLI report.
   *
   * Example output:
   * ```
   * Testing: monthly-spending
   *   Persona: young-professional
   *   ✓ tools_called: get_transactions
   *   ✓ response_accurate: yes
   *   ✗ no_hallucination: failed
   *   PASS (2,341ms)
   * ```
   */
  formatCli(report: TestReport): string {
    const lines: string[] = [];

    for (const result of report.results) {
      lines.push('');
      lines.push(this.formatCliResult(result));
    }

    // Summary
    lines.push('');
    lines.push(chalk.dim('\u2501'.repeat(40)));

    const passLabel = chalk.green.bold(`${report.passed} passed`);
    const failLabel =
      report.failed > 0
        ? chalk.red.bold(`${report.failed} failed`)
        : chalk.dim('0 failed');

    lines.push(
      `Results: ${passLabel}, ${failLabel} (${report.totalScenarios} total)`,
    );

    const durationSec = (report.duration / 1_000).toFixed(1);
    const costStr = `$${report.cost.total.toFixed(4)}`;
    lines.push(
      `Duration: ${durationSec}s | LLM Cost: ${costStr}`,
    );

    lines.push(chalk.dim('\u2501'.repeat(40)));

    return lines.join('\n');
  }

  private formatCliResult(result: TestResult): string {
    const lines: string[] = [];

    const statusIcon = result.passed
      ? chalk.green.bold('PASS')
      : chalk.red.bold('FAIL');

    lines.push(`Testing: ${chalk.bold(result.scenario)}`);
    lines.push(`  Persona: ${chalk.cyan(result.persona)}`);

    for (const evaluation of result.evaluations) {
      lines.push(this.formatCliEvaluation(evaluation));
    }

    const durationStr = this.formatDuration(result.duration);
    lines.push(`  ${statusIcon} (${durationStr})`);

    return lines.join('\n');
  }

  private formatCliEvaluation(evaluation: EvaluationDetail): string {
    const icon = evaluation.passed ? chalk.green('\u2713') : chalk.red('\u2717');
    const checkName = evaluation.check;

    let detail = '';
    if (evaluation.check === 'tools_called' && Array.isArray(evaluation.actual)) {
      detail = `: ${(evaluation.actual as string[]).join(', ')}`;
    } else if (evaluation.check === 'response_contains') {
      detail = evaluation.passed
        ? `: "${evaluation.expected}"`
        : `: missing "${evaluation.expected}"`;
    } else if (evaluation.check === 'max_latency_ms') {
      detail = `: ${evaluation.actual}ms / ${evaluation.expected}ms`;
    } else if (evaluation.explanation) {
      // Truncate long LLM explanations for CLI display
      const explanation =
        evaluation.explanation.length > 80
          ? evaluation.explanation.slice(0, 77) + '...'
          : evaluation.explanation;
      detail = evaluation.passed ? ': yes' : `: ${explanation}`;
    }

    return `  ${icon} ${checkName}${detail}`;
  }

  private formatDuration(ms: number): string {
    if (ms < 1_000) {
      return `${Math.round(ms)}ms`;
    }
    return `${(ms / 1_000).toFixed(1)}s`;
  }

  // -----------------------------------------------------------------------
  // JSON format
  // -----------------------------------------------------------------------

  /**
   * Serialize the full report as pretty-printed JSON.
   */
  formatJson(report: TestReport): string {
    return JSON.stringify(report, null, 2);
  }

  // -----------------------------------------------------------------------
  // JUnit XML format
  // -----------------------------------------------------------------------

  /**
   * Produce JUnit XML output compatible with GitHub Actions, Jenkins, and
   * other CI systems that consume the standard `<testsuites>` schema.
   */
  formatJunit(report: TestReport): string {
    const lines: string[] = [];

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(
      `<testsuites name="mimic" tests="${report.totalScenarios}" ` +
        `failures="${report.failed}" time="${(report.duration / 1_000).toFixed(3)}">`,
    );
    lines.push(
      `  <testsuite name="mimic-scenarios" tests="${report.totalScenarios}" ` +
        `failures="${report.failed}" time="${(report.duration / 1_000).toFixed(3)}">`,
    );

    for (const result of report.results) {
      const timeStr = (result.duration / 1_000).toFixed(3);
      const className = `mimic.${sanitizeXml(result.persona)}`;
      const testName = sanitizeXml(result.scenario);

      lines.push(
        `    <testcase classname="${className}" name="${testName}" time="${timeStr}">`,
      );

      if (!result.passed) {
        const failedChecks = result.evaluations.filter((e) => !e.passed);
        const failureMessage = failedChecks
          .map((e) => `[${e.check}] ${e.explanation ?? 'failed'}`)
          .join('\n');

        lines.push(
          `      <failure message="${sanitizeXml(failedChecks[0]?.explanation ?? 'Test failed')}" ` +
            `type="AssertionError">`,
        );
        lines.push(`        ${sanitizeXml(failureMessage)}`);
        lines.push('      </failure>');
      }

      // Include agent output as system-out for debugging
      lines.push('      <system-out>');
      lines.push(`        ${sanitizeXml(result.agentOutput)}`);
      lines.push('      </system-out>');

      lines.push('    </testcase>');
    }

    lines.push('  </testsuite>');
    lines.push('</testsuites>');

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape special XML characters to produce safe attribute values and text
 * content.  Handles the five predefined XML entities.
 */
function sanitizeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
