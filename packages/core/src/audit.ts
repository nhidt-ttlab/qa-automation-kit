import fs from 'node:fs';
import path from 'node:path';
import { redactObject } from './logger.js';

export interface AuditEntry {
  ts: string;
  seq: number;
  tool: string;
  /** The agent's stated reason for the call — required on mutating tools. */
  reason?: string;
  input: unknown;
  outcome: 'ok' | 'denied' | 'error';
  denyReason?: string;
  url?: string;
  durationMs?: number;
  /** Anything else worth keeping, e.g. an execution mode or HTTP status. */
  detail?: Record<string, unknown>;
}

/**
 * Append-only JSONL log of every tool call an agent made, with inputs redacted.
 *
 * This is what makes an agent-driven run reviewable after the fact: the report shows what was
 * asserted, and this shows what the agent tried — including the calls that were denied, which
 * never appear anywhere else.
 */
export class AuditLog {
  private seq = 0;

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  get path(): string {
    return this.filePath;
  }

  record(entry: Omit<AuditEntry, 'ts' | 'seq'>): void {
    this.seq += 1;
    const line: AuditEntry = {
      ts: new Date().toISOString(),
      seq: this.seq,
      ...entry,
      input: redactObject(entry.input),
    };
    try {
      fs.appendFileSync(this.filePath, `${JSON.stringify(line)}\n`);
    } catch {
      // Auditing must never break the tool call it is describing.
    }
  }
}
