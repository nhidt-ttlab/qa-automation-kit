import { observer } from 'mobx-react-lite';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { PlayArrowRounded } from '@mui/icons-material';
import type { RegressionRunStore } from '../store/RegressionRunStore';
import { CLEAN_CHOICE_OPTIONS, type CleanChoice } from '../types';
import { AdvancedFlagsSection } from './AdvancedFlagsSection';
import { ModuleMultiSelect } from './ModuleMultiSelect';
import { TestCaseIdChips } from './TestCaseIdChips';

/**
 * The "what to run" card. An observer because the draft lives in the store (see the note on
 * RegressionRunStore.draft), which is what lets a Rerun link seed it and the preview dialog read it.
 */
export const RunTriggerForm = observer(
  ({ store, onPreview }: { store: RegressionRunStore; onPreview: () => void }) => {
    const { draft, options } = store;
    const disabled = store.isSubmitting;
    const cleanHint = CLEAN_CHOICE_OPTIONS.find((o) => o.value === draft.clean)?.hint;

    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <Typography variant="h6">What to run</Typography>

          {options?.runner_available === false && (
            <Alert severity="error">
              {options.runner_unavailable_reason ?? 'The regression runner is not available.'}
            </Alert>
          )}

          <Box className="flex flex-wrap items-start gap-3">
            <TextField
              select
              label="Kind"
              size="small"
              className="min-w-[140px]"
              value={draft.kind}
              disabled={disabled}
              onChange={(e) =>
                store.patchDraft({ kind: e.target.value as typeof draft.kind })
              }
            >
              {/* '' means All and the key is omitted from the request entirely. */}
              <MenuItem value="">All</MenuItem>
              <MenuItem value="api">api</MenuItem>
              <MenuItem value="ui">ui</MenuItem>
            </TextField>

            <ModuleMultiSelect
              value={draft.modules}
              options={options?.module_tokens ?? []}
              disabled={disabled}
              onChange={(modules) => store.patchDraft({ modules })}
            />
          </Box>

          <Box className="flex flex-wrap items-start gap-3">
            <TestCaseIdChips
              value={draft.testCaseIds}
              disabled={disabled}
              onChange={(testCaseIds) => store.patchDraft({ testCaseIds })}
            />
            <TextField
              label="Grep"
              size="small"
              className="min-w-[220px]"
              value={draft.grep}
              disabled={disabled}
              onChange={(e) => store.patchDraft({ grep: e.target.value })}
              helperText="Substring of a scenario key or id"
            />
          </Box>

          {/*
            Permanently visible, never inside the advanced disclosure: "Everything" is the default
            and reaches far beyond the selection above, so it must never be something a user has to
            expand a section to discover.
          */}
          <FormControl>
            <FormLabel className="text-sm">Clean before running</FormLabel>
            <RadioGroup
              row
              value={draft.clean}
              onChange={(e) => store.patchDraft({ clean: e.target.value as CleanChoice })}
            >
              {CLEAN_CHOICE_OPTIONS.map((o) => (
                <FormControlLabel
                  key={o.value}
                  value={o.value}
                  disabled={disabled}
                  control={<Radio size="small" />}
                  label={o.label}
                />
              ))}
            </RadioGroup>
            {draft.clean === 'all' ? (
              <Alert severity="warning" className="mt-1">
                {cleanHint} MCP audit logs, batch summaries and session records are kept, and a full
                sync to the reporting database runs first.
              </Alert>
            ) : (
              <Typography variant="body2" className="text-gray-500">
                {cleanHint}
              </Typography>
            )}
          </FormControl>

          <AdvancedFlagsSection
            draft={draft}
            environments={options?.environments ?? []}
            disabled={disabled}
            onChange={(patch) => store.patchDraft(patch)}
          />

          <Box className="flex flex-wrap items-end justify-between gap-3">
            <TextField
              label="Your name"
              size="small"
              className="min-w-[220px]"
              value={store.actor}
              disabled={disabled}
              onChange={(e) => store.setActor(e.target.value)}
              helperText="Recorded on the run — this API has no login"
            />
            <Box className="flex gap-2">
              <Button onClick={() => store.resetDraft()} disabled={disabled}>
                Reset
              </Button>
              <Button
                variant="contained"
                startIcon={<PlayArrowRounded />}
                onClick={onPreview}
                disabled={!store.canSubmit}
              >
                Preview &amp; run
              </Button>
            </Box>
          </Box>
        </CardContent>
      </Card>
    );
  },
);
