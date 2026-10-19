#!/usr/bin/env node
/**
 * profile-spec.cjs — profile a spec source before writing the feature-extraction docs.
 *
 * Two source formats, one process:
 *   - **CSV sheet** (`.csv`): one exported sheet of a feature-list workbook.
 *   - **Markdown spec** (`.md`): a structured SRS / screen specification.
 *
 * Zero dependencies. Reports the numbers the extraction docs must state verbatim:
 * group (or section) structure, item counts, SpecID ranges, per-column evidence coverage,
 * native ids already present in the source, content that carries no item row, and
 * duplicated rows (copy-paste contamination).
 *
 * Usage:
 *   node profile-spec.cjs "<sheet.csv|spec.md>" [--prefix ORD] [--compare other] [--json]
 *                         [--config qakit.config.yaml] [--section "3.2"] [--list]
 *                         [--format csv|md] [--start N]
 *
 * --start N numbers the generated SpecIDs from N instead of 1, so a set cut by capability area can
 * profile one contributing section at a time and keep one continuous numbering across the set.
 *
 * With --config, a source argument that is not an existing path is looked up in the config's
 * `paths.specSource` folder (falling back to the older `paths.specCsv`): first as a file name,
 * then as a unique substring of one (e.g. a feature code). --compare resolves the same way.
 *
 * CSV row model (a heuristic — VERIFY it against each sheet):
 *   - header row   : record 1
 *   - heading row  : exactly one non-empty cell, in the first column  -> block / sub-group name
 *   - item row     : any other non-empty record                       -> one field/action, gets a SpecID
 *   - blank record : skipped entirely
 *
 * Markdown block model (a heuristic — VERIFY it against each document):
 *   - ATX heading          : `#`…`######`                        -> section / sub-section
 *   - item table           : pipe table with >=3 columns, or whose first column holds native ids
 *                                                                 -> one row = one item, gets a SpecID
 *   - attribute table      : 2-column pipe table without ids      -> screen metadata, NOT item rows
 *   - id-bearing bullet    : `* EC-OR02: …`                       -> one item, keeps its native id
 *   - narrative bullet     : any other bullet                     -> content with no SpecID anchor
 *   - gherkin scenario     : a section whose body has Given/When/Then lines
 *   - prose paragraph      : everything else                      -> content with no SpecID anchor
 *   - fenced code / frontmatter : skipped entirely
 */

const fs = require('fs');
const pathLib = require('path');

// ---------- CSV parsing (RFC 4180: quotes, escaped quotes, embedded newlines) ----------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (s) => (s == null ? '' : String(s).trim());
const isBlankRow = (r) => r.every((c) => clean(c) === '');
const isHeadingRow = (r) => clean(r[0]) !== '' && r.slice(1).every((c) => clean(c) === '');

/** An id the source already carries: `BR-OR01`, `ACT-02`, `SCR-ORD-CREATE`. Never a bare number. */
const NATIVE_ID = /^([A-Z][A-Z0-9]*(?:[-_.][A-Z0-9]+)+)\b/;
const nativeIdOf = (s) => {
  const m = NATIVE_ID.exec(clean(s).replace(/^[*_`\s]+/, ''));
  return m ? m[1] : null;
};

/** The first cell that names the item: neither an ordinal (`#` column) nor the id itself. */
const labelOf = (cells) => {
  for (const c of cells) {
    const v = clean(c);
    if (v === '' || v === '—' || /^\d+[.)]?$/.test(v) || nativeIdOf(v) === v) continue;
    return v;
  }
  return clean(cells[0]);
};

/** Heading/cell text with markdown emphasis and escapes removed — for matching only, never for output. */
const deEmphasize = (s) =>
  clean(s).replace(/\\([*_|`])/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

// ---------- args ----------
const VALUE_FLAGS = new Set(['--prefix', '--compare', '--config', '--section', '--format', '--start']);
const argv = process.argv.slice(2);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.has(argv[i - 1])));
const flag = (name) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? null : argv[i + 1];
};
const USAGE =
  'usage: node profile-spec.cjs "<sheet.csv|spec.md>" [--prefix XXX] [--compare other] [--json]\n' +
  '       [--config qakit.config.yaml] [--section "<heading>"] [--list] [--format csv|md] [--start N]';
if (!positional[0]) {
  console.error(USAGE);
  process.exit(2);
}
const prefix = flag('prefix') || 'ID';
const startAt = flag('start') === null ? 1 : Number(flag('start'));
if (!Number.isInteger(startAt) || startAt < 1) {
  console.error('--start must be a positive integer.');
  process.exit(2);
}
const asJson = argv.includes('--json');
const listOnly = argv.includes('--list');
const sectionArg = flag('section');
const formatFlag = flag('format');
if (formatFlag && formatFlag !== 'csv' && formatFlag !== 'md') {
  console.error('--format must be csv or md.');
  process.exit(2);
}

// ---------- source resolution via qakit.config.yaml `paths.specSource` / `paths.specCsv` ----------
/** Minimal reader for a `paths.*` key (block or flow style); avoids a YAML dependency. */
function readPathsKey(configPath, key) {
  const text = fs.readFileSync(configPath, 'utf8');
  const unquote = (v) => v.replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
  const lines = text.split(/\r?\n/);
  let inPaths = false;
  for (const line of lines) {
    if (/^paths:\s*\{/.test(line)) {
      const m = line.match(new RegExp(key + ':\\s*([^,}]+)'));
      if (m) return unquote(m[1]);
    }
    if (/^paths:\s*(#.*)?$/.test(line)) { inPaths = true; continue; }
    if (inPaths) {
      if (/^\S/.test(line)) break; // next top-level key
      const m = line.match(new RegExp('^\\s+' + key + ':\\s*(.+)$'));
      if (m) return unquote(m[1]);
    }
  }
  return null;
}

const configFile = flag('config');
let specDir = null;
if (configFile) {
  const dir = readPathsKey(configFile, 'specSource') || readPathsKey(configFile, 'specCsv');
  if (!dir) {
    console.error('Neither `paths.specSource` nor `paths.specCsv` is set in ' + configFile + '.');
    process.exit(2);
  }
  specDir = pathLib.resolve(pathLib.dirname(configFile), dir);
}

const SOURCE_EXT = ['.csv', '.md', '.markdown'];

function resolveSource(arg) {
  if (fs.existsSync(arg)) return arg;
  if (!specDir) return arg; // let readFileSync report it
  const direct = pathLib.join(specDir, arg);
  if (fs.existsSync(direct)) return direct;
  const needle = arg.toLowerCase();
  const matches = fs
    .readdirSync(specDir)
    .filter((name) => SOURCE_EXT.includes(pathLib.extname(name).toLowerCase()) && name.toLowerCase().includes(needle));
  if (matches.length === 1) return pathLib.join(specDir, matches[0]);
  console.error(
    matches.length
      ? '"' + arg + '" matches ' + matches.length + ' sources in ' + specDir + ':\n  ' + matches.join('\n  ')
      : 'No source matching "' + arg + '" in ' + specDir + '.',
  );
  process.exit(2);
}

const formatOf = (path) =>
  formatFlag || (['.md', '.markdown'].includes(pathLib.extname(path).toLowerCase()) ? 'md' : 'csv');

const file = resolveSource(positional[0]);

// ---------- CSV profile ----------
function profileCsv(path, idPrefix, firstId) {
  const rows = parseCsv(fs.readFileSync(path, 'utf8'));
  const header = (rows[0] || []).map(clean);
  const groups = [];
  const items = [];
  let current = null;

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (isBlankRow(cells)) continue;
    if (isHeadingRow(cells)) {
      current = { heading: clean(cells[0]), items: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { heading: '(rows before any heading)', items: [] };
      groups.push(current);
    }
    const item = { record: r + 1, cells };
    items.push(item);
    current.items.push(item);
  }

  items.forEach((it, i) => { it.specId = idPrefix + '-' + (firstId + i); });

  const coverage = header.map((name, ci) => ({
    column: name || '(col ' + ci + ')',
    filled: items.filter((it) => clean(it.cells[ci]) !== '').length,
  }));

  return {
    format: 'csv', path, header, groups, items,
    coverage: [{ columns: header, items: items.length, perColumn: coverage }],
    dupBlocks: duplicateBlocks(items, (it) => it.cells.map(clean).join('')),
    keys: new Set(items.map((it) => it.cells.map(clean).join(''))),
  };
}

/** Runs of item rows identical to an earlier row — copy-paste contamination. */
function duplicateBlocks(items, keyOf) {
  const seen = new Map();
  const dupBlocks = [];
  for (const it of items) {
    const k = keyOf(it);
    if (!seen.has(k)) { seen.set(k, it); continue; }
    const firstSeen = seen.get(k);
    const last = dupBlocks[dupBlocks.length - 1];
    const where = it.record != null ? it.record : it.line;
    const lastWhere = last ? (last.endRecord != null ? last.endRecord : last.endLine) : null;
    if (last && where === lastWhere + 1) {
      last.endRecord = where;
      last.endSpec = it.specId;
      last.count++;
    } else {
      dupBlocks.push({
        startRecord: where, endRecord: where,
        startSpec: it.specId, endSpec: it.specId,
        firstSeenSpec: firstSeen.specId, count: 1,
      });
    }
  }
  return dupBlocks;
}

// ---------- Markdown scanning ----------
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,3}([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_LINE = /^\s{0,3}\|/;
const TABLE_DELIM = /^\s{0,3}\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const GHERKIN = /^\s*(Given|When|Then|And|But)\b/i;

/** Splits a markdown table row into cells, honouring `\|` escapes. */
function splitRow(line) {
  const out = [];
  let cell = '';
  const s = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cell += '|'; i++; continue; }
    if (s[i] === '|') { out.push(cell.trim()); cell = ''; continue; }
    cell += s[i];
  }
  out.push(cell.trim());
  return out;
}

/** Walks the document into headings, tables, lists and prose, with the enclosing heading path. */
function scanMarkdown(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  const nodes = [];
  let i = 0;

  // YAML frontmatter
  if (clean(lines[0]) === '---') {
    let j = 1;
    while (j < lines.length && clean(lines[j]) !== '---') j++;
    if (j < lines.length) i = j + 1;
  }

  const stack = []; // open headings, by level
  const pathOf = () => stack.map((h) => h.text);

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (clean(line) === '') continue;

    const fence = FENCE.exec(line);
    if (fence) { // skip fenced code entirely
      const marker = fence[1][0];
      let j = i + 1;
      while (j < lines.length && !new RegExp('^\\s{0,3}' + marker + '{3,}').test(lines[j])) j++;
      i = j;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const node = { kind: 'heading', level: h[1].length, text: clean(h[2]), line: i + 1, path: [] };
      while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
      node.path = pathOf();
      stack.push(node);
      nodes.push(node);
      continue;
    }

    if (TABLE_LINE.test(line) && TABLE_DELIM.test(lines[i + 1] || '')) {
      const header = splitRow(line);
      const rows = [];
      let j = i + 2;
      for (; j < lines.length && TABLE_LINE.test(lines[j]); j++) {
        const cells = splitRow(lines[j]);
        if (cells.every((c) => c === '')) continue;
        rows.push({ line: j + 1, cells });
      }
      nodes.push({ kind: 'table', header, rows, line: i + 1, endLine: j, path: pathOf() });
      i = j - 1;
      continue;
    }

    const b = BULLET.exec(line);
    if (b) {
      const bullets = [];
      let j = i;
      for (; j < lines.length; j++) {
        const m = BULLET.exec(lines[j]);
        if (m) { bullets.push({ line: j + 1, text: clean(m[2]) }); continue; }
        if (clean(lines[j]) === '') break;
        if (HEADING.test(lines[j]) || TABLE_LINE.test(lines[j])) break;
        if (bullets.length) bullets[bullets.length - 1].text += ' ' + clean(lines[j]); // continuation
      }
      nodes.push({ kind: 'list', bullets, line: i + 1, endLine: j, path: pathOf() });
      i = j - 1;
      continue;
    }

    // prose paragraph
    const start = i;
    const text2 = [];
    let j = i;
    for (; j < lines.length; j++) {
      if (clean(lines[j]) === '') break;
      if (HEADING.test(lines[j]) || TABLE_LINE.test(lines[j]) || BULLET.test(lines[j]) || FENCE.test(lines[j])) break;
      text2.push(clean(lines[j]));
    }
    nodes.push({ kind: 'prose', text: text2.join(' '), line: start + 1, endLine: j, path: pathOf() });
    i = j - 1;
  }

  return { nodes, lineCount: lines.length };
}

/** Restricts the node list to one section (the heading plus everything under it). */
function selectSection(nodes, needle) {
  const wanted = deEmphasize(needle).toLowerCase();
  const heads = nodes.filter((n) => n.kind === 'heading');
  const matches = heads.filter((n) => deEmphasize(n.text).toLowerCase().includes(wanted));
  if (matches.length !== 1) {
    console.error(
      matches.length
        ? '"' + needle + '" matches ' + matches.length + ' headings:\n  ' +
          matches.map((m) => '#'.repeat(m.level) + ' ' + m.text + '  (line ' + m.line + ')').join('\n  ')
        : 'No heading matching "' + needle + '".',
    );
    process.exit(2);
  }
  const head = matches[0];
  const startIdx = nodes.indexOf(head);
  let endIdx = nodes.length;
  for (let k = startIdx + 1; k < nodes.length; k++) {
    if (nodes[k].kind === 'heading' && nodes[k].level <= head.level) { endIdx = k; break; }
  }
  return { nodes: nodes.slice(startIdx, endIdx), section: head };
}

// ---------- Markdown profile ----------
function profileMarkdown(path, idPrefix, section, firstId) {
  const scanned = scanMarkdown(fs.readFileSync(path, 'utf8'));
  let nodes = scanned.nodes;
  let scope = null;
  if (section) {
    const sel = selectSection(nodes, section);
    nodes = sel.nodes;
    scope = sel.section;
  }

  const blocks = [];
  const items = [];
  const narrative = [];
  const scenarios = [];
  const headings = nodes.filter((n) => n.kind === 'heading');

  let tableNo = 0, listNo = 0;
  for (const n of nodes) {
    const under = n.path.length ? n.path[n.path.length - 1] : '(document root)';

    if (n.kind === 'table') {
      tableNo++;
      const ids = n.rows.map((r) => nativeIdOf(r.cells[0]));
      const hasIds = ids.some(Boolean);
      const isItemTable = n.header.length >= 3 || hasIds;
      const block = {
        id: 'T' + tableNo, kind: isItemTable ? 'item table' : 'attribute table',
        under, heading: n.path.join(' › '), line: n.line, endLine: n.endLine,
        columns: n.header, count: n.rows.length, nativeIds: ids.filter(Boolean).length,
      };
      blocks.push(block);
      if (!isItemTable) continue;
      n.rows.forEach((r, ri) => {
        items.push({
          line: r.line, block: block.id, under, columns: n.header, cells: r.cells,
          nativeId: ids[ri], label: labelOf(r.cells),
        });
      });
      continue;
    }

    if (n.kind === 'list') {
      listNo++;
      const withId = n.bullets.filter((b) => nativeIdOf(b.text));
      const block = {
        id: 'L' + listNo,
        kind: withId.length === n.bullets.length ? 'id-bearing bullets'
          : withId.length ? 'mixed bullets' : 'narrative bullets',
        under, heading: n.path.join(' › '), line: n.line, endLine: n.endLine,
        columns: [], count: n.bullets.length, nativeIds: withId.length,
      };
      blocks.push(block);
      for (const b of n.bullets) {
        const id = nativeIdOf(b.text);
        if (id) items.push({ line: b.line, block: block.id, under, columns: ['(bullet)'], cells: [b.text], nativeId: id, label: b.text });
        else narrative.push({ kind: 'bullet', line: b.line, under, text: b.text });
      }
      continue;
    }

    if (n.kind === 'prose') {
      if (GHERKIN.test(n.text)) scenarios.push({ line: n.line, under, text: n.text });
      else narrative.push({ kind: 'prose', line: n.line, under, text: n.text });
    }
  }

  // SpecIDs: a native id is reused verbatim; only unnamed items get a generated one.
  let generated = 0;
  for (const it of items) {
    if (it.nativeId) it.specId = it.nativeId;
    else it.specId = idPrefix + '-' + (firstId + generated++);
  }
  const idCounts = new Map();
  for (const it of items) idCounts.set(it.specId, (idCounts.get(it.specId) || 0) + 1);
  const duplicateIds = [...idCounts.entries()].filter(([, c]) => c > 1).map(([id, c]) => ({ id, count: c }));

  // Families of ids the source already uses (`BR-OR01`, `BR-OR02` -> `BR-OR`), to declare in the docs.
  const families = new Map();
  for (const it of items) {
    if (!it.nativeId) continue;
    const fam = /^(.*?)(\d+)$/.exec(it.nativeId);
    const key = fam ? fam[1] : it.nativeId;
    if (!families.has(key)) families.set(key, { count: 0, numbers: [] });
    const entry = families.get(key);
    entry.count++;
    if (fam) { entry.numbers.push(Number(fam[2])); entry.width = Math.max(entry.width || 0, fam[2].length); }
  }
  // A number missing from a family (`BR-OR04`) is a source anomaly: report it, never renumber.
  for (const entry of families.values()) {
    const seen = new Set(entry.numbers);
    entry.gaps = entry.numbers.length
      ? Array.from({ length: Math.max(...entry.numbers) }, (_, i) => i + 1).filter((n) => !seen.has(n))
      : [];
  }

  // Evidence coverage per distinct item-table shape (column sets differ between sections).
  // Bullet items have no columns, so they are counted separately rather than faked into a shape.
  const shapes = new Map();
  const bulletItems = items.filter((it) => it.columns[0] === '(bullet)');
  for (const it of items) {
    if (it.columns[0] === '(bullet)') continue;
    const key = it.columns.join(' | ');
    if (!shapes.has(key)) shapes.set(key, { columns: it.columns, items: [] });
    shapes.get(key).items.push(it);
  }
  const coverage = [...shapes.values()].map((s) => ({
    columns: s.columns,
    items: s.items.length,
    perColumn: s.columns.map((name, ci) => ({
      column: name || '(col ' + ci + ')',
      filled: s.items.filter((it) => clean(it.cells[ci]) !== '' && clean(it.cells[ci]) !== '—').length,
    })),
  }));

  const keyOf = (it) => it.cells.map(clean).join('');
  return {
    format: 'md', path, scope, headings, blocks, items, narrative, scenarios,
    coverage, duplicateIds, generated, bulletItems: bulletItems.length,
    idFamilies: [...families.entries()].map(([family, e]) => ({ family, count: e.count, gaps: e.gaps, width: e.width || 0 })),
    dupBlocks: duplicateBlocks(items.map((it) => ({ ...it, record: it.line })), keyOf),
    keys: new Set(items.map(keyOf)),
  };
}

const profile = (path, idPrefix, section, firstId = 1) =>
  formatOf(path) === 'md' ? profileMarkdown(path, idPrefix, section, firstId) : profileCsv(path, idPrefix, firstId);

if (sectionArg && formatOf(file) === 'csv') {
  console.error('--section applies to markdown sources only.');
  process.exit(2);
}

const p = profile(file, prefix, sectionArg, startAt);

// ---------- output ----------
if (listOnly) {
  if (p.format !== 'md') {
    console.error('--list applies to markdown sources only.');
    process.exit(2);
  }
  console.log('\n# ' + p.path + ' — sections\n');
  console.log('| Level | Heading (verbatim) | Line |');
  console.log('|---|---|---|');
  p.headings.forEach((h) => console.log('| ' + 'H' + h.level + ' | ' + h.text + ' | ' + h.line + ' |'));
  console.log('\nProfile one of them with: --section "<part of the heading>"\n');
  process.exit(0);
}

if (asJson) {
  const common = {
    file: p.path,
    format: p.format,
    totalItems: p.items.length,
    coverage: p.coverage,
    duplicateBlocks: p.dupBlocks,
  };
  console.log(JSON.stringify(
    p.format === 'csv'
      ? {
          ...common,
          columns: p.header,
          groups: p.groups.map((g) => ({
            heading: g.heading,
            items: g.items.length,
            specFrom: g.items.length ? g.items[0].specId : null,
            specTo: g.items.length ? g.items[g.items.length - 1].specId : null,
          })),
        }
      : {
          ...common,
          section: p.scope ? { heading: p.scope.text, level: p.scope.level, line: p.scope.line } : null,
          headings: p.headings.map((h) => ({ level: h.level, heading: h.text, line: h.line })),
          blocks: p.blocks,
          items: p.items.map((it) => ({ specId: it.specId, nativeId: it.nativeId, label: it.label, block: it.block, under: it.under, line: it.line })),
          nativeIdsReused: p.items.length - p.generated,
          generatedIds: p.generated,
          idFamilies: p.idFamilies,
          bulletItems: p.bulletItems,
          duplicateIds: p.duplicateIds,
          narrativeBlocks: p.narrative.map((n) => ({ kind: n.kind, under: n.under, line: n.line })),
          gherkinScenarios: p.scenarios.map((s) => ({ under: s.under, line: s.line })),
        },
    null, 2,
  ));
  process.exit(0);
}

console.log('\n# ' + p.path + '  (' + (p.format === 'md' ? 'markdown spec' : 'CSV sheet') + ')');

if (p.format === 'csv') {
  const first = (g) => (g.items.length ? g.items[0] : null);
  const last = (g) => (g.items.length ? g.items[g.items.length - 1] : null);

  console.log('\nColumns (' + p.header.length + '): ' + p.header.join(' | '));
  console.log('\nItem rows: ' + p.items.length + '   Heading rows: ' +
    p.groups.filter((g) => g.heading !== '(rows before any heading)').length);
  console.log('SpecID range: ' + (p.items.length ? p.items[0].specId + ' … ' + p.items[p.items.length - 1].specId : '-'));

  console.log('\n## Groups (verbatim heading text — do not normalize)\n');
  console.log('| # | Heading | CSV rows | SpecID range | Items |');
  console.log('|---|---|---|---|---|');
  p.groups.forEach((g, i) => {
    const f = first(g), l = last(g);
    const span = f ? f.record + '–' + l.record : '_(block marker — no item rows of its own)_';
    const ids = f ? f.specId + ' → ' + l.specId : '-';
    console.log('| ' + (i + 1) + ' | ' + g.heading + ' | ' + span + ' | ' + ids + ' | ' + g.items.length + ' |');
  });
} else {
  console.log('\nScope: ' + (p.scope ? '"' + p.scope.text + '" (line ' + p.scope.line + ')' : 'whole document'));
  console.log('Item rows: ' + p.items.length + '   Sections: ' + p.headings.length +
    '   Blocks: ' + p.blocks.length);
  console.log('SpecIDs: ' + (p.items.length - p.generated) + ' reused verbatim from the source, ' +
    p.generated + ' generated as ' + prefix + '-n');

  console.log('\n## Sections (verbatim heading text — do not normalize)\n');
  console.log('| Level | Heading | Line | Items |');
  console.log('|---|---|---|---|');
  p.headings.forEach((h) => {
    const n = p.items.filter((it) => it.under === h.text).length;
    console.log('| H' + h.level + ' | ' + h.text + ' | ' + h.line + ' | ' + (n || '—') + ' |');
  });

  console.log('\n## Blocks\n');
  console.log('| Block | Kind | Under | Lines | Rows | Native ids | Columns |');
  console.log('|---|---|---|---|---|---|---|');
  p.blocks.forEach((b) => console.log(
    '| ' + b.id + ' | ' + b.kind + ' | ' + b.under + ' | ' + b.line + '–' + b.endLine + ' | ' + b.count +
    ' | ' + (b.nativeIds || '—') + ' | ' + (b.columns.length ? b.columns.join(' \\| ') : '—') + ' |',
  ));
  const attrTables = p.blocks.filter((b) => b.kind === 'attribute table');
  if (attrTables.length) {
    console.log('\n**Attribute tables** (' + attrTables.map((b) => b.id).join(', ') +
      ') are screen metadata, not item rows — no SpecID is assigned to them. Check that reading.');
  }

  if (p.idFamilies.length) {
    console.log('\n**Native id families:** ' +
      p.idFamilies.map((f) => '`' + f.family + '*` (' + f.count + ')').join(', ') +
      ' — reuse these verbatim as SpecIDs; declare each family in `00-index.md`.');
    const gapped = p.idFamilies.filter((f) => f.gaps.length);
    if (gapped.length) {
      console.log('\n**Gaps in the source numbering:** ' +
        gapped.map((f) => f.gaps.map((n) => '`' + f.family + String(n).padStart(f.width, '0') + '`').join(', ')).join('; ') +
        ' — the source skips these ids. Report the gap; never renumber to close it.');
    }
  }

  const SHOW_ITEMS = 60;
  if (p.items.length && (sectionArg || p.items.length <= SHOW_ITEMS)) {
    console.log('\n## Items (one SpecID each)\n');
    console.log('| SpecID | Source id | Under | Block | Line | Label |');
    console.log('|---|---|---|---|---|---|');
    p.items.forEach((it) => console.log(
      '| ' + it.specId + ' | ' + (it.nativeId || '_generated_') + ' | ' + it.under + ' | ' + it.block +
      ' | ' + it.line + ' | ' + clean(it.label).replace(/\|/g, '\\|') + ' |',
    ));
  } else if (p.items.length) {
    console.log('\n_' + p.items.length + ' item rows — re-run with `--section "<heading>"` or `--json` for the full item list._');
  }
}

console.log('\n## Evidence coverage' +
  (p.format === 'csv' ? ' (filled / ' + p.items.length + ' item rows)'
    : p.coverage.length > 1 ? ' (per item-table shape)' : '') + '\n');
if (!p.coverage.length || !p.items.length) {
  console.log('_No item rows in scope._');
} else {
  p.coverage.forEach((shape, si) => {
    if (p.format === 'md') {
      console.log((si ? '\n' : '') + '**Shape ' + (si + 1) + '** — ' + shape.columns.join(' | ') +
        '  (' + shape.items + ' item rows)\n');
    }
    console.log('| Column | Filled | % |');
    console.log('|---|---|---|');
    shape.perColumn.forEach((c) => console.log(
      '| ' + c.column + ' | ' + c.filled + ' | ' + (shape.items ? ((c.filled / shape.items) * 100).toFixed(0) : '0') + '% |',
    ));
    const empties = shape.perColumn.filter((c) => c.filled === 0).map((c) => c.column);
    if (empties.length) {
      console.log('\n**100% empty columns:** ' + empties.join(', ') + ' — never invent values for these.');
    }
  });
  if (p.format === 'md' && p.bulletItems) {
    console.log('\n' + p.bulletItems + ' further item row(s) come from id-bearing bullets, which have no columns — ' +
      'their evidence is the bullet text itself.');
  }
}

if (p.format === 'md') {
  if (p.duplicateIds.length) {
    console.log('\n## Duplicated native ids\n');
    p.duplicateIds.forEach((d) => console.log('- `' + d.id + '` appears ' + d.count + ' times — the source reuses an id; flag it, do not renumber.'));
  }

  const narrativeBy = new Map();
  p.narrative.forEach((n) => narrativeBy.set(n.under, (narrativeBy.get(n.under) || 0) + 1));
  console.log('\n## Content with no item row (' + p.narrative.length + ' blocks, ' +
    p.scenarios.length + ' Gherkin lines)\n');
  if (!p.narrative.length && !p.scenarios.length) {
    console.log('_None — every block in scope carries item rows._');
  } else {
    console.log('| Under | Narrative blocks | Gherkin lines |');
    console.log('|---|---|---|');
    const unders = [...new Set([...p.narrative.map((n) => n.under), ...p.scenarios.map((s) => s.under)])];
    unders.forEach((u) => console.log('| ' + u + ' | ' + (narrativeBy.get(u) || 0) + ' | ' +
      p.scenarios.filter((s) => s.under === u).length + ' |'));
    console.log('\nThis content must still reach the docs, but it has no row to hang a SpecID on — ' +
      'carry it in the screen file\'s prose and, where it yields a testcase of its own, under `EP-<n>`.');
  }
}

if (p.dupBlocks.length) {
  console.log('\n## Duplicated item rows (possible copy-paste contamination)\n');
  console.log('| ' + (p.format === 'md' ? 'Lines' : 'CSV rows') + ' | SpecIDs | Count | Identical to (first occurrence) |');
  console.log('|---|---|---|---|');
  p.dupBlocks.forEach((b) => console.log(
    '| ' + b.startRecord + '–' + b.endRecord + ' | ' + b.startSpec + ' → ' + b.endSpec +
    ' | ' + b.count + ' | from ' + b.firstSeenSpec + ' |'
  ));
  console.log('\nFlag these with the blocking marker (a question that blocks testcase writing); do not silently drop or merge them.');
} else {
  console.log('\nNo duplicated item rows within this ' + (p.format === 'md' ? 'document' : 'sheet') + '.');
}

const otherArg = flag('compare');
if (otherArg) {
  const other = resolveSource(otherArg);
  const q = profile(other, 'CMP', null);
  let shared = 0;
  for (const k of p.keys) if (q.keys.has(k)) shared++;
  console.log('\n## Cross-source compare vs ' + other + '\n');
  console.log('Item rows identical in both sources: **' + shared + '** (of ' + p.items.length +
    ' here / ' + q.items.length + ' there).');
  if (shared) console.log('Investigate before extracting — shared blocks are usually contamination, not real duplication.');
}
console.log('');
