import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  FormControlLabel,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { ExpandMoreRounded, ExpandLessRounded } from '@mui/icons-material';
import { CLEANUP_OPTIONS, countChangedAdvanced, type RunJobDraft } from '../types';
import { CustomParamsEditor } from './CustomParamsEditor';

/**
 * The flags that are not the common case, behind a disclosure.
 *
 * A `Collapse` plus a text button rather than an `Accordion`: Accordion brings its own paper,
 * summary and divider chrome that would fight the themed MuiCard this sits inside, and would need
 * theme work to look right. Collapse is pure layout with no appearance of its own.
 *
 * Clean scope is deliberately NOT in here - it is the destructive default and stays visible.
 */
export function AdvancedFlagsSection({
  draft,
  environments,
  onChange,
  disabled,
}: {
  draft: RunJobDraft;
  environments: string[];
  onChange: (patch: Partial<RunJobDraft>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const changed = countChangedAdvanced(draft, environments[0]);
  const uiOnly = draft.kind !== 'ui';

  return (
    <Box>
      <Box className="flex items-center gap-2">
        <Button
          size="small"
          onClick={() => setOpen(!open)}
          startIcon={open ? <ExpandLessRounded /> : <ExpandMoreRounded />}
        >
          Advanced flags
        </Button>
        {/* So a non-default flag can never hide behind a collapsed section. */}
        {changed > 0 && <Chip size="small" color="primary" label={`${changed} changed`} />}
      </Box>

      <Collapse in={open}>
        <Box className="flex flex-col gap-3 pt-3">
          <Box className="flex flex-wrap items-end gap-3">
            <TextField
              select
              label="Environment"
              size="small"
              className="min-w-[160px]"
              value={draft.environment}
              disabled={disabled}
              onChange={(e) => onChange({ environment: e.target.value })}
            >
              {(environments.length > 0 ? environments : [draft.environment]).map((env) => (
                <MenuItem key={env} value={env}>
                  {env}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Data mode"
              size="small"
              className="min-w-[190px]"
              value={draft.dataMode}
              disabled={disabled}
              onChange={(e) =>
                onChange({ dataMode: e.target.value as RunJobDraft['dataMode'] })
              }
              helperText={
                draft.dataMode === 'seeded'
                  ? 'Creates prerequisite rows in the shared tenant'
                  : 'Uses data that already exists'
              }
            >
              <MenuItem value="existing">existing</MenuItem>
              <MenuItem value="seeded">seeded</MenuItem>
            </TextField>

            {/*
              Tri-state, not a checkbox. The runner's own cleanup default flips with write mode, so
              sending `false` unconditionally would emit --no-cleanup on every write run and leave
              unmarked rows in shared UAT.
            */}
            <TextField
              select
              label="Marker cleanup"
              size="small"
              className="min-w-[190px]"
              value={draft.cleanup === null ? '' : String(draft.cleanup)}
              disabled={disabled}
              onChange={(e) =>
                onChange({ cleanup: e.target.value === '' ? null : e.target.value === 'true' })
              }
            >
              {CLEANUP_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          <Box className="flex flex-wrap items-center gap-4">
            <FormControlLabel
              control={
                <Checkbox
                  checked={draft.bail}
                  disabled={disabled}
                  onChange={(e) => onChange({ bail: e.target.checked })}
                />
              }
              label="Stop at the first failure"
            />

            <Tooltip title={uiOnly ? 'UI scenarios only' : ''}>
              <span>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={draft.headed}
                      disabled={disabled || uiOnly}
                      onChange={(e) => onChange({ headed: e.target.checked })}
                    />
                  }
                  label="Show the browser window"
                />
              </span>
            </Tooltip>

            <Tooltip title={uiOnly ? 'UI scenarios only' : ''}>
              <span>
                <TextField
                  label="Slow-mo (ms)"
                  size="small"
                  type="number"
                  className="w-[140px]"
                  value={draft.uiSlowMoMs ?? ''}
                  disabled={disabled || uiOnly}
                  onChange={(e) =>
                    onChange({ uiSlowMoMs: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  inputProps={{ min: 0, max: 5000 }}
                />
              </span>
            </Tooltip>
          </Box>

          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={draft.writeMode}
                  disabled={disabled}
                  onChange={(e) => onChange({ writeMode: e.target.checked })}
                />
              }
              label="Allow destructive writes"
            />
            {draft.writeMode && (
              <Typography variant="body2" className="text-red-600 ml-8">
                Switches the runner's write mode on — the run will create and modify real records in
                the shared QA tenant.
              </Typography>
            )}
          </Box>

          {/*
            Last, and inside the disclosure: unlike every control above it, this one maps to no
            runner flag the API knows about, so it is the one place a suite can be handed an input
            this form was never told about. That makes it powerful and rarely needed - exactly the
            combination the advanced section is for.
          */}
          <Box className="border-t pt-3">
            <CustomParamsEditor
              value={draft.customParams}
              disabled={disabled}
              onChange={(customParams) => onChange({ customParams })}
            />
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}
