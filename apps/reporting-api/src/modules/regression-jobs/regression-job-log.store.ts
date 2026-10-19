import { reportingDataDir } from '../../common/reporting-data-dir';
/**
 * A job's log: appended to disk as JSONL, fanned out live to SSE subscribers, and replayable from
 * any sequence number.
 *
 * Three requirements shape this:
 *
 *   - A 1140-scenario batch's log has no business in a `text` column, so it goes to a file. JSONL
 *     gives each line a sequence, a timestamp and a producer for free.
 *   - A browser that reconnects must not lose the lines it missed, so every line carries a gapless
 *     sequence and the file can be replayed from an offset. That is also what makes the SSE
 *     `Last-Event-ID` header work.
 *   - Writes must never block the child process. Node's stream buffering handles that; we only
 *     have to avoid awaiting each line.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Subject, type Observable } from 'rxjs';
import type { RegressionJobLogLineDto, RegressionJobLogStream } from '@qakit/reporting-shared';

/** Where a job's log file lives. Relative to this root, so moving it does not orphan old rows. */
export function resolveJobLogStorageRoot(): string {
  const value = process.env.JOB_LOG_STORAGE_PATH || './storage/job-logs';
  return path.resolve(reportingDataDir(), value);
}

export function jobLogRelativePath(jobId: number): string {
  return `job-${jobId}.jsonl`;
}

/**
 * One job's live log. Created when the job starts and closed when it ends; a terminal job's log is
 * read straight off disk with no store at all.
 */
export class RegressionJobLog {
  private readonly filePath: string;
  private stream: fs.WriteStream | null = null;
  private readonly subject = new Subject<RegressionJobLogLineDto>();
  private seq = 0;

  constructor(
    readonly jobId: number,
    root: string = resolveJobLogStorageRoot(),
  ) {
    fs.mkdirSync(root, { recursive: true });
    this.filePath = path.join(root, jobLogRelativePath(jobId));
  }

  get lineCount(): number {
    return this.seq;
  }

  get lines$(): Observable<RegressionJobLogLineDto> {
    return this.subject.asObservable();
  }

  append(stream: RegressionJobLogStream, text: string): RegressionJobLogLineDto {
    const line: RegressionJobLogLineDto = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      stream,
      text,
    };
    if (!this.stream) {
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    }
    // Not awaited: the child's stdout must never wait on our disk. Node buffers, and close()
    // flushes before resolving.
    this.stream.write(`${JSON.stringify(line)}\n`);
    this.subject.next(line);
    return line;
  }

  /** Flushes the file and completes the observable, ending every open SSE stream. */
  async close(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      await new Promise<void>((resolve) => stream.end(resolve));
    }
    this.subject.complete();
  }
}

/**
 * Reads a slice of a job's log off disk.
 *
 * Used for the tail endpoint and for the replay half of an SSE stream, so a reconnecting browser
 * gets the lines it missed before the live ones resume. A missing file is an empty log, not an
 * error: a job can be asked for its log before it has written a line.
 */
export function readJobLogFromDisk(
  jobId: number,
  fromSeq: number,
  limit: number,
  root: string = resolveJobLogStorageRoot(),
): RegressionJobLogLineDto[] {
  const filePath = path.join(root, jobLogRelativePath(jobId));
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const out: RegressionJobLogLineDto[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let parsed: RegressionJobLogLineDto;
    try {
      parsed = JSON.parse(line) as RegressionJobLogLineDto;
    } catch {
      // A torn final line is expected while the job is still writing; skip it rather than fail
      // the whole read.
      continue;
    }
    if (parsed.seq > fromSeq) out.push(parsed);
    if (out.length >= limit) break;
  }
  return out;
}

/** Deletes a job's log file. Only used when a job row is removed. */
export function deleteJobLog(jobId: number, root: string = resolveJobLogStorageRoot()): void {
  try {
    fs.rmSync(path.join(root, jobLogRelativePath(jobId)), { force: true });
  } catch {
    // A log that is already gone is the desired state.
  }
}
