import { Box, Chip, MenuItem, TextField } from '@mui/material';

/**
 * The first multi-select in this app.
 *
 * Built from `TextField select` + `MenuItem` - the one MUI form primitive the rest of the
 * codebase uses - with `SelectProps.multiple` as the whole delta. `Autocomplete` would be the
 * obvious alternative but brings a new component family and a new theming surface for a list of
 * about thirty closed values, and the filter-panel convention here explicitly avoids it.
 *
 * The vocabulary comes from the runner itself (GET /options), not a hard-coded list, so a new
 * suite folder shows up without a frontend change.
 */
export function ModuleMultiSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <TextField
      select
      label="Modules"
      size="small"
      className="min-w-[260px]"
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value as unknown as string[] | string;
        onChange(typeof next === 'string' ? next.split(',') : next);
      }}
      SelectProps={{
        multiple: true,
        renderValue: (selected) => (
          <Box className="flex flex-wrap gap-1">
            {(selected as string[]).map((m) => (
              <Chip key={m} label={m} size="small" />
            ))}
          </Box>
        ),
      }}
      helperText={value.length === 0 ? 'All modules' : `${value.length} selected`}
    >
      {options.map((option) => (
        <MenuItem key={option} value={option}>
          {option}
        </MenuItem>
      ))}
    </TextField>
  );
}
