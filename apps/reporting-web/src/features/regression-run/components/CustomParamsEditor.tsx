import { Box, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import { AddRounded, DeleteOutlineRounded } from '@mui/icons-material';
import {
  MAX_REGRESSION_CUSTOM_ENV_ENTRIES,
  REGRESSION_CUSTOM_ENV_NAME_PATTERN,
  REGRESSION_CUSTOM_ENV_RESERVED,
} from '@qakit/reporting-shared';
import type { CustomParam } from '../types';

/**
 * The custom-parameter rows: extra environment variables handed to the runner.
 *
 * This exists because a suite can need an input the form has no field for — a fixture path, the
 * list of project ids one measurement covers — and the form has no way to learn about it. Every
 * other control here maps to a runner flag the API enumerates; this one deliberately does not,
 * which is what lets a new suite be driven from this page without a release of the reporting app.
 *
 * Environment variables rather than extra CLI arguments, because the runner's `parseArgs` only
 * *warns* on an argument it does not recognise: a mistyped flag would be swallowed and the batch
 * would run with the setting silently absent, whereas a suite reading its own variable refuses
 * loudly when the variable is wrong.
 *
 * Validation is a hint, never a gate. The API is the authority on names and reserved keys (see
 * `normalizeCustomEnv`), and duplicating that judgement here as a disabled submit button would
 * mean two rule sets to keep in step. What the field does is say, before the round trip, why the
 * API is about to refuse.
 */
export function CustomParamsEditor({
  value,
  onChange,
  disabled,
}: {
  value: CustomParam[];
  onChange: (params: CustomParam[]) => void;
  disabled?: boolean;
}) {
  const rows = value.length > 0 ? value : [{ key: '', value: '' }];

  const patchRow = (index: number, patch: Partial<CustomParam>): void => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    // A row that ends up entirely blank is kept, not pruned: deleting the row someone is halfway
    // through clearing would take the focused input out from under them.
    onChange(next);
  };

  const addRow = (): void => onChange([...rows, { key: '', value: '' }]);
  const removeRow = (index: number): void => onChange(rows.filter((_, i) => i !== index));

  const named = rows.filter((r) => r.key.trim() !== '').length;
  const atLimit = named >= MAX_REGRESSION_CUSTOM_ENV_ENTRIES;

  return (
    <Box className="flex flex-col gap-2">
      <Typography variant="body2" className="text-gray-600">
        Custom parameters — set as environment variables in the runner process. Recorded on the job,
        so the run stays reproducible; they are stored in plain text, so keep credentials out of them.
      </Typography>

      {rows.map((row, index) => {
        const name = row.key.trim().toUpperCase();
        const error = nameProblem(name);
        return (
          <Box key={index} className="flex items-start gap-2">
            <TextField
              label="Name"
              size="small"
              className="min-w-[260px]"
              value={row.key}
              disabled={disabled}
              error={Boolean(error)}
              helperText={error ?? ' '}
              onChange={(e) => patchRow(index, { key: e.target.value })}
              placeholder="REPLACE_MATERIAL_PROJECT_IDS"
            />
            <TextField
              label="Value"
              size="small"
              className="flex-1 min-w-[260px]"
              value={row.value}
              disabled={disabled}
              helperText=" "
              onChange={(e) => patchRow(index, { value: e.target.value })}
            />
            <Tooltip title="Remove this parameter">
              <span>
                <IconButton
                  aria-label="Remove this parameter"
                  size="small"
                  className="mt-1"
                  disabled={disabled || rows.length === 1}
                  onClick={() => removeRow(index)}
                >
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        );
      })}

      <Box>
        <Tooltip title={atLimit ? `At most ${MAX_REGRESSION_CUSTOM_ENV_ENTRIES} parameters` : ''}>
          <span>
            <IconButton
              aria-label="Add a parameter"
              size="small"
              disabled={disabled || atLimit}
              onClick={addRow}
            >
              <AddRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}

/** The API's own rules, restated as a hint. An empty name is the blank row, not a mistake. */
function nameProblem(name: string): string | null {
  if (name === '') return null;
  if (!REGRESSION_CUSTOM_ENV_NAME_PATTERN.test(name)) {
    return 'Letters, digits and _ only, starting with a letter';
  }
  if ((REGRESSION_CUSTOM_ENV_RESERVED as readonly string[]).includes(name)) {
    return 'Reserved — the runner is given this one by the server';
  }
  return null;
}
