import { useState, type KeyboardEvent } from 'react';
import { Box, Chip, TextField } from '@mui/material';

/**
 * Free-text entry for exact testcase ids.
 *
 * A dropdown is the wrong shape here: there are over a thousand ids, and people arrive with them
 * already in hand - pasted from a batch summary, a Redmine ticket or a failing run. So this
 * commits a token on Enter, on a comma, and on blur, and splits a paste on whitespace, commas or
 * semicolons.
 *
 * Ids are matched exactly by the runner (unlike grep, which is a substring), so they are
 * uppercased and de-duplicated here and validated against the real catalog by the API.
 */
export function TestCaseIdChips({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');

  const commit = (raw: string): void => {
    const tokens = raw
      .split(/[\s,;]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (tokens.length === 0) return;
    const next = [...value];
    for (const token of tokens) if (!next.includes(token)) next.push(token);
    onChange(next);
    setText('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(text);
      return;
    }
    // Backspace on an empty input pops the last chip, the standard token-field affordance.
    if (e.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <TextField
      label="Test case ids"
      size="small"
      className="min-w-[320px] flex-1"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => commit(text)}
      placeholder={value.length === 0 ? 'TC-DH-L01, TC-KHO-A02 …' : ''}
      helperText="Matched exactly. Paste or type ids, then press Enter."
      InputProps={{
        startAdornment:
          value.length > 0 ? (
            <Box className="flex flex-wrap gap-1 mr-2">
              {value.map((id) => (
                <Chip
                  key={id}
                  label={id}
                  size="small"
                  onDelete={disabled ? undefined : () => onChange(value.filter((v) => v !== id))}
                />
              ))}
            </Box>
          ) : null,
      }}
    />
  );
}
