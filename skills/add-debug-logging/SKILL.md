---
name: add-debug-logging
description: Adds purposeful, structured diagnostic logging to code as it is written, so a failure can be traced from the logs alone. Apply it while implementing a plan task, a feature, a bug fix or a new code path (endpoint, handler, service method, job, worker, command, hook, sync step) in any language; when a plan is being written (it owns the plan's "Logging and diagnostics" section); and when the user asks to add, fix or review logging, or a bug could not be diagnosed because the logs said nothing. Uses the project's own logger and conventions from its knowledge file.
---

## Project settings

This skill is part of the QA automation kit and works on any project; it does not need a running test
harness. Before starting:

1. Locate the project's `qakit.config.yaml` — the path named in the "QA automation kit" section of the
   project's `CLAUDE.md`, otherwise the repository root — and read `paths.knowledge`. No config: look
   for a logging policy in the repository docs and go on with step 3.
2. Read `<paths.knowledge>/add-debug-logging.md` and `<paths.knowledge>/project.md` if present. The
   knowledge file names, per repository or surface: the logger to use, the message and key
   conventions, level rules, the correlation id, redaction helpers, where logs go and how to raise the
   level. **Its conventions win over the generic patterns below.** It does not relax the privacy rules.
3. Open the file being changed and one or two neighbours. If they already log through a wrapper,
   prefixed helper or event-key catalogue, use exactly that — a second logging style in one module is
   a defect, not a preference.

## When This Skill Applies

- **Implementing** — a plan task, feature, fix or refactor that adds or changes behavior. The log
  points ship in the same change and the same commit as the code they describe, never as a follow-up.
- **Planning** — a plan for such a change carries a `Logging and diagnostics` section (template below);
  the planning skill links here for it.
- **Debugging** — a failure could not be explained from the logs: add the missing lines at the
  decision point that was blind, and keep them if they would have helped.
- **Asked** — "add logging", "fix the logs", "why is there nothing in the log".

Not for: pure formatting, renames, generated code, tests (unless the test harness has its own
diagnostics convention), or code that has no runtime behavior.

---

## What Good Debug Logging Is

The test for every line: *if this operation fails in production next month, does this line help
someone who has only the log file find out why?* A log that says `called` a thousand times fails that
test; a log that says which branch was taken, with which ids, passes it.

Log at these points:

1. **Boundaries** — an operation starts at a system edge (request, message, job, command, UI action)
   with its key identifiers; it ends with the outcome and duration. Often the framework or an existing
   middleware already does this — then don't duplicate it.
2. **Decisions** — the branch that changes the result: permission denied, fallback taken, cache miss,
   conflict detected, item skipped, retry scheduled, feature flag off. Log *which* branch and *why*.
3. **State changes** — something was created, moved, deleted, renamed, versioned, locked, published.
   One line per real change, with the ids before/after.
4. **External calls** — database, storage, HTTP, queue, OS/native API: what was called and the
   outcome. Log the detail (status, body excerpt) on failure only.
5. **Failures** — every `catch` / error path that handles, converts or swallows an error logs it once,
   with the exception object and the context ids. A path that only rethrows does not log; the layer
   that finally handles the error does. Never log and rethrow the same error at every layer.
6. **Summaries** — loops and batches log one summary (counts: processed, changed, skipped, failed),
   not one line per item. Per-item lines only on the item's own failure path, at debug.

Do **not** log:

- routine per-item success, per-iteration chatter, "entered/leaving" lines for every function;
- trivial getters, pure helpers, mappers, constructors, generated code;
- the same event twice at two layers;
- expected/idempotent outcomes ("already exists", "nothing changed") above debug.

## Levels

| Level | Use for |
|---|---|
| trace / verbose | Internals only useful when tracing one bug live (per-page, per-chunk). |
| debug | Routine per-call detail, branch taken on a normal path, per-item failure detail. Off in production by default. |
| information | One line per meaningful event: a state actually changed, an operation completed, a pass produced a result. |
| warning | Unexpected but handled: denial, fallback, degraded mode, retry scheduled, bad input rejected, 4xx/5xx from a dependency. |
| error | The operation failed and will not be completed. Carries the exception. |
| critical / fatal | The process cannot continue. |

If the project's logger has no debug level, keep debug-worthy detail out rather than promoting it to
information — say so in the plan or hand-off if that leaves a blind spot.

## Message Shape

- **Stable, searchable event text** — a fixed phrase or event key per event, not prose that changes
  per call. `upload confirm: size mismatch` greps; `Oops, the size of file X didn't match` does not.
- **Identify the source** — the project's prefix or key convention (for example `[Component]
  method: event`, or an event-key constant). Consistent within a module.
- **Structured fields for the variables** — ids, counts, status, duration, the branch taken, as named
  properties (message templates, key-value pairs, a context object). Never string-interpolate values
  into a structured-logging template: it breaks querying and can inject fake log lines.
- **Correlation** — include, or rely on the ambient scope for, the request/operation/correlation id so
  one flow can be followed across components and services. When a flow crosses a process boundary,
  pass the id along.
- **Enough context to act** — the ids of the entities involved, the input that decided the branch, the
  count or size that was out of range. Not the whole payload.

## Privacy and Safety (not relaxed by any knowledge file)

- Never log secrets: passwords, tokens, API keys, cookies, `Authorization` headers, signed/presigned
  URLs, connection strings, private keys. Use the project's redaction helper if it has one.
- Never log personal data beyond an opaque id (no emails, names, phone numbers, document content,
  file contents, raw JWT claims) unless the project's knowledge file allows a field explicitly.
- Never log full request/response bodies by default — an excerpt on failure, after redaction.
- Log values that came from users or clients as structured fields, not concatenated into the message
  (log forging).
- Logging must not change behavior: no side effects in log arguments, no exceptions thrown from
  logging, no expensive work unless the level is enabled (guard it or use lazy evaluation).

---

## Generic Patterns (use only when the project has no convention)

### C# / .NET — `ILogger<T>` with message templates

```csharp
_logger.LogDebug("[OrderService] Cancel: order={OrderId} state={State}", orderId, order.State);
if (!order.CanCancel)
{
    _logger.LogWarning("[OrderService] Cancel: rejected order={OrderId} state={State}", orderId, order.State);
    return Result.Conflict();
}
// ... mutate
_logger.LogInformation("[OrderService] Cancel: cancelled order={OrderId} refunds={RefundCount}", orderId, refunds.Count);
```

`catch (Exception ex) { _logger.LogError(ex, "... order={OrderId}", orderId); ... }` only where the
error is handled. Placeholders `{Name}`, never `$"..."` interpolation.

### TypeScript / JavaScript

Use the project's logger module; otherwise a small prefixed helper per module rather than bare
`console.log`:

```ts
const log = createLogger('orders.service'); // [orders.service] event, payload
log.debug('cancel: start', { orderId });
log.warn('cancel: rejected', { orderId, state });
log.error('cancel: failed', { orderId, err });
```

Log the result's shape (count, id, status) rather than the full object; never log request headers.

### Rust — `tracing` (or `log`)

```rust
tracing::debug!(order_id = %id, "cancel: start");
tracing::warn!(order_id = %id, state = ?state, "cancel: rejected");
tracing::error!(order_id = %id, error = %e, "cancel: failed");
```

Prefer fields over formatted strings; use `#[tracing::instrument(skip(secret_args))]` for spans.

### Python — `logging`

```python
log = logging.getLogger(__name__)
log.info("cancel: cancelled", extra={"order_id": order_id, "refunds": len(refunds)})
log.exception("cancel: failed order_id=%s", order_id)  # inside except, keeps the traceback
```

Pass values as arguments (`%s`), not f-strings, so formatting is lazy.

### Java / Kotlin — SLF4J

```java
log.warn("cancel: rejected orderId={} state={}", orderId, state);
log.error("cancel: failed orderId={}", orderId, e); // exception last
```

### Go — `log/slog`

```go
slog.Warn("cancel: rejected", "order_id", id, "state", state)
```

---

## Step-by-Step Process

### While implementing

1. **Load the conventions** (Project settings above). Note the logger, prefix/key convention, level
   rules and redaction helper for the repository you are in.
2. **List the log points before writing code** — for the change at hand, walk the six categories
   (boundaries, decisions, state changes, external calls, failures, summaries) and write down the few
   lines that would let someone diagnose each way the change can fail. If a plan has a `Logging and
   diagnostics` section, start from it.
3. **Check what already logs** — middleware, framework, the caller. Don't duplicate a boundary line or
   an error that an outer handler already records.
4. **Add the lines with the code**, in the same edit. New event keys go into the project's key
   catalogue if it has one.
5. **Verify**:
   - the code builds / type-checks and existing tests still pass (tests that assert on log output
     count too);
   - run the path once (unit test with a captured logger, local run, or scenario) and look at the
     actual lines: right level, ids present, nothing secret, not flooding;
   - if a line only appears at debug, say how to turn debug on (from the knowledge file).
6. **Report** in the reply or hand-off: the new log events (text or key, level, where), and how to see
   them. Record any deliberate blind spot.

### While planning

Add this section to the plan (the planning skill places it after the implementation parts):

```markdown
## Logging and diagnostics

Conventions: <logger + prefix/key convention per repo, from the knowledge file>.

| Where (repo · file/class) | Event (message or key) | Level | Fields | Why — which failure it explains |
|---|---|---|---|---|
| svc · OrderService.Cancel | `[OrderService] Cancel: rejected` | Warning | OrderId, State | cancel refused — which state blocked it |
| svc · OrderService.Cancel | `[OrderService] Cancel: cancelled` | Information | OrderId, RefundCount | proves the mutation happened |
| web · orders.service | `cancel: failed` | error | orderId, status | client-side failure with the server status |

- **Correlation:** <how the flow's id reaches every line above>
- **Not logged on purpose:** <secrets/PII/per-item success left out, and why>
- **How to see it:** <log file / console / sink, and how to raise the level locally>
```

Each implementation task then says "add the log points listed for it" — logging is part of the task's
definition of done, not a separate task at the end.

---

## Checklist

- [ ] Used the project's logger and prefix/key convention; no second logging style in the module.
- [ ] Every new decision branch that changes the outcome, and every state change, has a line with ids.
- [ ] Every handled/swallowed error logs once, with the exception and context; rethrow-only paths don't.
- [ ] Loops/batches log a summary, not a line per item; per-item only on failure, at debug.
- [ ] Levels follow the table (or the project's rules); expected outcomes are not warning+.
- [ ] Structured fields/templates, no string interpolation into templates.
- [ ] Correlation id present or carried by the ambient scope.
- [ ] No secrets, tokens, signed URLs, personal data or full bodies.
- [ ] Built, tests pass, and the new lines were seen in a real run (or it's said why not).
- [ ] New events listed in the reply / hand-off with how to see them.
