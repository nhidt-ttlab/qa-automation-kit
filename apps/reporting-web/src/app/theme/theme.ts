import { createTheme } from '@mui/material/styles';

import { tokens } from './tokens';

/**
 * Application theme.
 *
 * Every MUI surface (AppBar, Card, Table, Button…) is styled here rather than with utility
 * classes on the component: MUI's own class selectors and Tailwind utilities share the same
 * specificity, so mixing the two makes the winner depend on stylesheet order. The theme wins
 * unconditionally, and `StyledEngineProvider injectFirst` (see App.tsx) keeps the remaining
 * Tailwind layout classes predictable.
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: tokens.brand[600],
      light: tokens.brand[500],
      dark: tokens.brand[700],
      contrastText: tokens.neutral[0],
    },
    success: { main: tokens.status.success },
    warning: { main: tokens.status.warning },
    error: { main: tokens.status.error },
    info: { main: tokens.status.info },
    background: {
      default: tokens.neutral[50],
      paper: tokens.neutral[0],
    },
    text: {
      primary: tokens.neutral[900],
      secondary: tokens.neutral[500],
    },
    divider: tokens.neutral[200],
  },

  shape: { borderRadius: tokens.radius.sm },

  typography: {
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h4: { fontSize: '1.625rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontSize: '1.0625rem', fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle2: { fontWeight: 600 },
    body2: { fontSize: '0.875rem' },
    button: { fontWeight: 600, letterSpacing: 0 },
  },

  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(255, 255, 255, 0.88)',
          backdropFilter: 'blur(8px)',
          color: tokens.neutral[900],
          borderBottom: `1px solid ${tokens.neutral[200]}`,
          backgroundImage: 'none',
        },
      },
    },

    MuiDrawer: {
      styleOverrides: { paper: { border: 'none', backgroundImage: 'none' } },
    },

    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.lg,
          border: `1px solid ${tokens.neutral[200]}`,
          boxShadow: tokens.shadow.card,
          backgroundImage: 'none',
        },
      },
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: tokens.radius.sm, paddingInline: 16 },
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: tokens.shadow.raised },
        },
      },
    },

    MuiIconButton: {
      styleOverrides: { root: { borderRadius: tokens.radius.sm } },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.sm,
          backgroundColor: tokens.neutral[0],
          '& .MuiOutlinedInput-notchedOutline': { borderColor: tokens.neutral[200] },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: tokens.neutral[400] },
        },
      },
    },

    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44, borderBottom: `1px solid ${tokens.neutral[200]}` },
        indicator: { height: 3, borderRadius: '3px 3px 0 0' },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.9375rem',
          minHeight: 44,
          color: tokens.neutral[500],
          '&.Mui-selected': { color: tokens.brand[600] },
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottomColor: tokens.neutral[100],
          paddingBlock: 12,
        },
        head: {
          backgroundColor: tokens.neutral[25],
          color: tokens.neutral[600],
          fontSize: '0.75rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          lineHeight: 1.4,
          borderBottom: `1px solid ${tokens.neutral[200]}`,
          whiteSpace: 'nowrap',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:last-child td': { borderBottom: 0 },
          '&.MuiTableRow-hover:hover': { backgroundColor: tokens.brand[50] },
        },
      },
    },
    MuiTablePagination: {
      styleOverrides: {
        root: { borderTop: `1px solid ${tokens.neutral[100]}` },
        selectLabel: { color: tokens.neutral[500] },
        displayedRows: { color: tokens.neutral[500] },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, borderRadius: 6, letterSpacing: '0.02em' },
        sizeSmall: { height: 22, fontSize: '0.6875rem' },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: tokens.navy[800],
          fontSize: '0.75rem',
          fontWeight: 500,
          borderRadius: 6,
          paddingBlock: 6,
        },
        arrow: { color: tokens.navy[800] },
      },
    },

    /**
     * MUI's default is a hard-coded dark grey, which is unreadable on the dark navigation
     * rail. Inheriting lets the list item own its colour in both light and dark surfaces.
     */
    MuiListItemIcon: {
      styleOverrides: { root: { color: 'inherit', minWidth: 0 } },
    },

    MuiDivider: {
      styleOverrides: { root: { borderColor: tokens.neutral[200] } },
    },
  },
});

export default theme;
