export interface RequestLogEntry {
  timestamp: Date;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  responseStatus: number;
  responseBody?: unknown;
  duration: number;
}

/**
 * Records HTTP requests flowing through the mock server.
 *
 * Useful for debugging and replay: start recording, run the agent,
 * then inspect which endpoints were called and with what payloads.
 */
export class RequestLogger {
  private entries: RequestLogEntry[] = [];
  private recording = false;

  startRecording(): void {
    this.recording = true;
  }

  stopRecording(): void {
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  log(entry: RequestLogEntry): void {
    if (this.recording) {
      this.entries.push(entry);
    }
  }

  getEntries(): RequestLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  /** Export entries for replay testing */
  exportForReplay(): RequestLogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }
}
