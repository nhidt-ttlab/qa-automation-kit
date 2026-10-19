import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import {
  RESOLUTION_KIND,
  RESOLUTION_PRIORITY,
  RESOLUTION_TYPE,
  RESOLUTION_WORKFLOW_STATUS,
} from '@qakit/reporting-shared';
import type { ResolutionIssueDetailResponseDto } from '@qakit/reporting-shared';
import {
  KIND_HINT,
  KIND_LABEL,
  RESOLUTION_TYPE_LABEL,
  VERB_EXPLANATION,
  WORKFLOW_STATUS_LABEL,
} from '../types';

/**
 * The four verbs, one panel each, each stating what it means before asking for input.
 *
 * They are separate on purpose. Users conflate "we discussed it", "we decided it", "we fixed it"
 * and "we proved it" constantly, and the workflow's value comes entirely from keeping them apart:
 * a comment changes nothing, a resolution is still only a claim, and only evidence from a later
 * run closes the issue.
 */

interface PanelProps {
  issue: ResolutionIssueDetailResponseDto;
  disabled: boolean;
  store: {
    updateIssue: (id: string, fields: Record<string, unknown>) => Promise<boolean>;
    changeStatus: (id: string, target: string, reason?: string) => Promise<boolean>;
    recordDecision: (id: string, decision: string) => Promise<boolean>;
    recordResolution: (id: string, resolution: string, type: string) => Promise<boolean>;
    verify: (
      id: string,
      input: { note: string; runId?: string; override?: boolean; overrideReason?: string },
    ) => Promise<boolean>;
    reopen: (id: string, reason: string) => Promise<boolean>;
    linkDefect: (id: string, defectId: string | null) => Promise<boolean>;
    linkRedmine: (id: string, redmineIssueId: number, url?: string) => Promise<boolean>;
  };
}

function Recorded({ label, value, by, at }: { label: string; value: string; by?: string | null; at?: string | null }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3">
      <Typography variant="caption" className="text-gray-500">
        {label}
        {by ? ` — ${by}` : ''}
        {at ? ` · ${new Date(at).toLocaleString()}` : ''}
      </Typography>
      <Typography variant="body2" className="whitespace-pre-wrap break-words text-dark-900">
        {value}
      </Typography>
    </div>
  );
}

export function ClassificationPanel({ issue, disabled, store }: PanelProps) {
  const [kind, setKind] = useState(issue.kind);
  const [owner, setOwner] = useState(issue.owner ?? '');
  const [priority, setPriority] = useState(issue.priority ?? '');
  const [userSummary, setUserSummary] = useState(issue.user_summary ?? '');

  const save = () =>
    void store.updateIssue(issue.id, {
      kind,
      owner: owner.trim() || null,
      priority: priority || null,
      user_summary: userSummary.trim() || null,
    });

  return (
    <Card>
      <CardHeader
        title="Classification"
        subheader="What kind of blocker is this, and who owns it? Set by a person — the import never guesses."
      />
      <CardContent className="space-y-3">
        <TextField
          select
          label="Kind"
          size="small"
          fullWidth
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          helperText={KIND_HINT[kind]}
        >
          {Object.values(RESOLUTION_KIND).map((k) => (
            <MenuItem key={k} value={k}>
              {KIND_LABEL[k]}
            </MenuItem>
          ))}
        </TextField>
        <div className="flex gap-3">
          <TextField
            label="Owner"
            size="small"
            fullWidth
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
          <TextField
            select
            label="Priority"
            size="small"
            className="min-w-[140px]"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
          >
            <MenuItem value="">None</MenuItem>
            {Object.values(RESOLUTION_PRIORITY).map((p) => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
        </div>
        <TextField
          label="Your summary"
          size="small"
          fullWidth
          multiline
          minRows={2}
          value={userSummary}
          onChange={(e) => setUserSummary(e.target.value)}
          helperText="Your words. The imported summary above stays as the runner wrote it."
        />
        <Button variant="contained" disabled={disabled} onClick={save}>
          Save classification
        </Button>
      </CardContent>
    </Card>
  );
}

export function DecisionPanel({ issue, disabled, store }: PanelProps) {
  const [decision, setDecision] = useState('');
  const canDecide =
    issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.OPEN ||
    issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.WAITING_FOR_DECISION ||
    issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.RECURRED;

  return (
    <Card>
      <CardHeader title="Decision" subheader={VERB_EXPLANATION.decision} />
      <CardContent className="space-y-3">
        {issue.decision && (
          <Recorded
            label="Recorded decision"
            value={issue.decision}
            by={issue.decision_by}
            at={issue.decision_at}
          />
        )}
        {canDecide ? (
          <>
            <TextField
              label="Decision"
              placeholder="What is the system supposed to do?"
              size="small"
              fullWidth
              multiline
              minRows={3}
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                variant="contained"
                disabled={disabled || !decision.trim()}
                onClick={() => void store.recordDecision(issue.id, decision).then(() => setDecision(''))}
              >
                Record decision
              </Button>
              {issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.OPEN && (
                <Button
                  variant="outlined"
                  disabled={disabled}
                  onClick={() =>
                    void store.changeStatus(issue.id, RESOLUTION_WORKFLOW_STATUS.WAITING_FOR_DECISION)
                  }
                >
                  Ask for a decision
                </Button>
              )}
            </div>
          </>
        ) : (
          <Typography variant="body2" className="text-gray-500">
            A decision cannot be recorded from {WORKFLOW_STATUS_LABEL[issue.workflow_status]}.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function ResolutionPanel({ issue, disabled, store }: PanelProps) {
  const [resolution, setResolution] = useState('');
  const [type, setType] = useState<string>(RESOLUTION_TYPE.SPEC_CLARIFIED);
  const canResolve =
    issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.DECIDED ||
    issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.RECURRED;

  return (
    <Card>
      <CardHeader title="Resolution" subheader={VERB_EXPLANATION.resolution} />
      <CardContent className="space-y-3">
        {issue.resolution && (
          <Recorded
            label={`Recorded resolution (${
              issue.resolution_type ? RESOLUTION_TYPE_LABEL[issue.resolution_type] : '—'
            })`}
            value={issue.resolution}
            by={issue.resolved_by}
            at={issue.resolved_at}
          />
        )}
        {canResolve ? (
          <>
            <TextField
              select
              label="Resolution type"
              size="small"
              fullWidth
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {Object.values(RESOLUTION_TYPE).map((t) => (
                <MenuItem key={t} value={t}>
                  {RESOLUTION_TYPE_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="What was changed or prepared"
              size="small"
              fullWidth
              multiline
              minRows={3}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
            <Alert severity="info" className="text-sm">
              Recording a resolution moves this to <strong>Ready for rerun</strong>, not to
              Verified. Only evidence from a later run can close it.
            </Alert>
            <Button
              variant="contained"
              disabled={disabled || !resolution.trim()}
              onClick={() =>
                void store.recordResolution(issue.id, resolution, type).then(() => setResolution(''))
              }
            >
              Record resolution
            </Button>
          </>
        ) : (
          <Typography variant="body2" className="text-gray-500">
            A resolution can only be recorded once a decision exists.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function VerificationPanel({ issue, disabled, store }: PanelProps) {
  const [note, setNote] = useState('');
  const [runId, setRunId] = useState('');
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const canVerify =
    issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.READY_FOR_RERUN ||
    issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.RECURRED;

  return (
    <Card>
      <CardHeader title="Verification" subheader={VERB_EXPLANATION.verification} />
      <CardContent className="space-y-3">
        {issue.verification_note && (
          <Recorded
            label={
              issue.verification_run_id
                ? `Verified against run ${issue.verification_run_id}`
                : 'Verified manually (no rerun)'
            }
            value={issue.verification_note}
            by={issue.verified_by}
            at={issue.verified_at}
          />
        )}
        {canVerify ? (
          <>
            <TextField
              label="Verification note"
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <TextField
              label="Rerun id"
              placeholder="run-…"
              size="small"
              fullWidth
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              disabled={override}
              helperText="Must have started after the resolution and exercise one of the scenarios above."
            />
            <Button size="small" variant="text" onClick={() => setOverride(!override)}>
              {override ? 'Use a rerun instead' : 'No rerun is possible'}
            </Button>
            {override && (
              <TextField
                label="Why can this not be verified by a rerun?"
                size="small"
                fullWidth
                multiline
                minRows={2}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                helperText="Recorded as a manual override, separately from evidence-backed verifications."
              />
            )}
            <Button
              variant="contained"
              disabled={
                disabled || !note.trim() || (override ? !overrideReason.trim() : !runId.trim())
              }
              onClick={() =>
                void store
                  .verify(issue.id, { note, runId, override, overrideReason })
                  .then(() => {
                    setNote('');
                    setRunId('');
                    setOverrideReason('');
                  })
              }
            >
              Verify
            </Button>
          </>
        ) : (
          <Typography variant="body2" className="text-gray-500">
            Verification opens once a resolution has been recorded.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function LinksPanel({ issue, disabled, store }: PanelProps) {
  const [defectId, setDefectId] = useState(issue.defect_signature_id ?? '');
  const [redmineId, setRedmineId] = useState('');
  const [redmineUrl, setRedmineUrl] = useState('');
  const isProductDefect = issue.kind === RESOLUTION_KIND.PRODUCT_DEFECT;

  return (
    <Card>
      <CardHeader
        title="Links"
        subheader="An existing defect signature, and Redmine — for confirmed product defects only."
      />
      <CardContent className="space-y-3">
        {issue.defect && (
          <div className="rounded border border-gray-200 p-3">
            <Typography variant="caption" className="text-gray-500">
              Linked defect {issue.defect.id} · {issue.defect.status}
            </Typography>
            <Typography variant="body2">{issue.defect.title}</Typography>
            {issue.defect.bug_links.map((b) => (
              <Chip
                key={b.id}
                size="small"
                className="mt-1 mr-1"
                label={`Redmine #${b.redmine_issue_id}`}
                component="a"
                href={b.redmine_url ?? undefined}
                clickable={Boolean(b.redmine_url)}
              />
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <TextField
            label="Defect signature id"
            size="small"
            fullWidth
            value={defectId}
            onChange={(e) => setDefectId(e.target.value)}
          />
          <Button
            variant="outlined"
            disabled={disabled}
            onClick={() => void store.linkDefect(issue.id, defectId.trim() || null)}
          >
            {defectId.trim() ? 'Link' : 'Unlink'}
          </Button>
        </div>

        <Divider />

        {issue.redmine_links.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {issue.redmine_links.map((l) => (
              <Chip
                key={l.id}
                size="small"
                label={`Redmine #${l.redmine_issue_id}`}
                component="a"
                href={l.redmine_url ?? undefined}
                clickable={Boolean(l.redmine_url)}
              />
            ))}
          </div>
        )}
        {isProductDefect ? (
          <div className="flex gap-2">
            <TextField
              label="Redmine issue id"
              size="small"
              value={redmineId}
              onChange={(e) => setRedmineId(e.target.value)}
            />
            <TextField
              label="Redmine URL"
              size="small"
              fullWidth
              value={redmineUrl}
              onChange={(e) => setRedmineUrl(e.target.value)}
            />
            <Button
              variant="outlined"
              disabled={disabled || !Number(redmineId)}
              onClick={() =>
                void store
                  .linkRedmine(issue.id, Number(redmineId), redmineUrl)
                  .then(() => {
                    setRedmineId('');
                    setRedmineUrl('');
                  })
              }
            >
              Link
            </Button>
          </div>
        ) : (
          <Alert severity="info" className="text-sm">
            Redmine linking opens once this is classified as a <strong>Product defect</strong>.
            Nothing here files a Redmine issue automatically — an unresolved blocker usually is
            not a product defect at all.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function LifecyclePanel({ issue, disabled, store }: PanelProps) {
  const [reason, setReason] = useState('');
  const isFinal =
    issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.VERIFIED ||
    issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.WONT_RESOLVE;

  return (
    <Card>
      <CardHeader title="Lifecycle" subheader="Reopen, or close without resolving." />
      <CardContent className="space-y-3">
        <TextField
          label="Reason"
          size="small"
          fullWidth
          multiline
          minRows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          helperText="Required to reopen. Prior decision, resolution and verification are kept."
        />
        <div className="flex flex-wrap gap-2">
          {isFinal && (
            <Button
              variant="outlined"
              color="warning"
              disabled={disabled || reason.trim().length < 3}
              onClick={() => void store.reopen(issue.id, reason).then(() => setReason(''))}
            >
              Reopen
            </Button>
          )}
          {!isFinal && (
            <Button
              variant="outlined"
              disabled={disabled}
              onClick={() =>
                void store.changeStatus(
                  issue.id,
                  RESOLUTION_WORKFLOW_STATUS.WONT_RESOLVE,
                  reason || undefined,
                )
              }
            >
              Won’t resolve
            </Button>
          )}
          {issue.workflow_status === RESOLUTION_WORKFLOW_STATUS.RECURRED && (
            <Button
              variant="outlined"
              disabled={disabled}
              onClick={() =>
                void store.changeStatus(
                  issue.id,
                  RESOLUTION_WORKFLOW_STATUS.READY_FOR_RERUN,
                  reason || undefined,
                )
              }
            >
              Mark ready for rerun
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
