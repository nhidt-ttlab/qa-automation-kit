import { Alert, TextField } from '@mui/material';

/**
 * Who is making the change.
 *
 * The reporting application has no authentication — there is no user model, no login and no
 * session — so identity here is self-asserted and stored verbatim on every comment and audit
 * event. Saying so plainly is the honest option: a silent "QA Team" default would make the audit
 * trail look authoritative when it is not.
 */
export function ActorField({
  actor,
  onChange,
}: {
  actor: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <TextField
        label="Your name"
        size="small"
        fullWidth
        required
        value={actor}
        onChange={(e) => onChange(e.target.value)}
        helperText="Recorded against every change you make on this page."
      />
      {!actor.trim() && (
        <Alert severity="info" className="text-sm">
          Enter your name to enable the actions below. This app has no sign-in, so the name is
          taken at face value and is not verified.
        </Alert>
      )}
    </div>
  );
}
