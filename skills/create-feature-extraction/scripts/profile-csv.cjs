#!/usr/bin/env node
/**
 * profile-csv.cjs — former name of `profile-spec.cjs`, which now profiles CSV sheets *and*
 * Markdown specs. Kept so older knowledge files and notes keep working; CSV behaviour is
 * unchanged. New invocations should call `profile-spec.cjs` directly.
 */
console.error('[deprecated] profile-csv.cjs is now profile-spec.cjs — same CSV behaviour, plus Markdown sources.');
require('./profile-spec.cjs');
