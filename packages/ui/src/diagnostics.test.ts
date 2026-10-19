import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { DiagnosticsCollector } from './diagnostics.js';

type DialogHandler = (dialog: FakeDialog) => void;

interface FakeDialog {
  type: () => string;
  message: () => string;
  accept: () => Promise<void>;
  dismiss: () => Promise<void>;
}

/** A page stand-in that only records handlers, so the dialog policy is testable without a browser. */
function fakePage(): { page: Page; emitDialog: (dialog: FakeDialog) => void } {
  const handlers: DialogHandler[] = [];
  const page = {
    on(event: string, handler: DialogHandler) {
      if (event === 'dialog') handlers.push(handler);
    },
  } as unknown as Page;
  return { page, emitDialog: (dialog) => handlers.forEach((handler) => handler(dialog)) };
}

function dialog(type: string, message: string, calls: string[]): FakeDialog {
  return {
    type: () => type,
    message: () => message,
    accept: async () => {
      calls.push('accept');
    },
    dismiss: async () => {
      calls.push('dismiss');
    },
  };
}

test('an alert or confirm is dismissed, so an unexpected one cannot hang the run', () => {
  const calls: string[] = [];
  const { page, emitDialog } = fakePage();
  new DiagnosticsCollector().attach(page);

  emitDialog(dialog('confirm', 'Delete this?', calls));
  emitDialog(dialog('alert', 'Saved', calls));

  assert.deepEqual(calls, ['dismiss', 'dismiss']);
});

test('a beforeunload dialog is accepted, so the navigation the scenario asked for proceeds', () => {
  const calls: string[] = [];
  const { page, emitDialog } = fakePage();
  new DiagnosticsCollector().attach(page);

  // Dismissing this one means "stay on the page", which would hang page.reload() until it times out.
  emitDialog(dialog('beforeunload', 'Uploads are still running', calls));

  assert.deepEqual(calls, ['accept']);
});

test('every dialog is recorded, whichever way it was settled', () => {
  const calls: string[] = [];
  const { page, emitDialog } = fakePage();
  const collector = new DiagnosticsCollector();
  collector.attach(page);

  emitDialog(dialog('beforeunload', 'Uploads are still running', calls));
  emitDialog(dialog('confirm', 'Delete this?', calls));

  const recorded = collector.snapshot().dialogs;
  assert.equal(recorded.length, 2);
  assert.deepEqual(
    recorded.map((entry) => [entry.type, entry.message]),
    [
      ['beforeunload', 'Uploads are still running'],
      ['confirm', 'Delete this?'],
    ],
  );
});
