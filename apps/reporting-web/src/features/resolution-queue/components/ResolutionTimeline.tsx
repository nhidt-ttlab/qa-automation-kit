import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  TextField,
  Typography,
} from '@mui/material';
import type {
  ResolutionCommentResponseDto,
  ResolutionEventResponseDto,
} from '@qakit/reporting-shared';
import { VERB_EXPLANATION, WORKFLOW_STATUS_LABEL } from '../types';

/**
 * Discussion, kept visibly separate from the audit trail below it.
 *
 * Comments stay readable after an issue is resolved, verified or reopened — the argument that led
 * to a decision is usually the most valuable thing on the page a month later — and adding one
 * never moves the issue. Rendered as text; nothing here interprets user input as markup.
 */
export function CommentTimeline({
  comments,
  disabled,
  onAdd,
}: {
  comments: ResolutionCommentResponseDto[];
  disabled: boolean;
  onAdd: (body: string) => void;
}) {
  const [body, setBody] = useState('');

  return (
    <Card>
      <CardHeader title="Discussion" subheader={VERB_EXPLANATION.comment} />
      <CardContent className="space-y-3">
        {comments.length === 0 && (
          <Typography variant="body2" className="text-gray-500">
            No comments yet.
          </Typography>
        )}
        {comments.map((c) => (
          <div key={c.id} className="rounded border border-gray-200 p-3">
            <Typography variant="caption" className="text-gray-500">
              {c.author} · {new Date(c.created_at).toLocaleString()}
              {c.edited ? ' · edited' : ''}
            </Typography>
            <Typography variant="body2" className="whitespace-pre-wrap break-words text-dark-900">
              {c.body}
            </Typography>
          </div>
        ))}
        <Divider />
        <TextField
          label="Add a comment"
          size="small"
          fullWidth
          multiline
          minRows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button
          variant="outlined"
          disabled={disabled || !body.trim()}
          onClick={() => {
            onAdd(body);
            setBody('');
          }}
        >
          Comment
        </Button>
      </CardContent>
    </Card>
  );
}

/** Append-only history. Every state change in this feature writes exactly one entry. */
export function EventTimeline({ events }: { events: ResolutionEventResponseDto[] }) {
  return (
    <Card>
      <CardHeader
        title="History"
        subheader="Every change, in order. Entries by system:sync came from an evidence import."
      />
      <CardContent className="space-y-2">
        {events.map((e) => (
          <div key={e.id} className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 pb-2">
            <Chip size="small" variant="outlined" label={e.action.replaceAll('_', ' ').toLowerCase()} />
            {e.new_status && (
              <Typography variant="caption" className="text-gray-600">
                {e.previous_status ? `${WORKFLOW_STATUS_LABEL[e.previous_status]} → ` : ''}
                {WORKFLOW_STATUS_LABEL[e.new_status]}
              </Typography>
            )}
            <Typography variant="caption" className="text-gray-500">
              {e.actor} · {new Date(e.created_at).toLocaleString()}
            </Typography>
            {e.note && (
              <Typography
                variant="body2"
                className="w-full whitespace-pre-wrap break-words text-dark-900"
              >
                {e.note}
              </Typography>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
