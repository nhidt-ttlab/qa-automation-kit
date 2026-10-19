/**
 * Design tokens — the single source of truth for colour, radius and elevation.
 *
 * Both the MUI theme and the handful of raw `sx` values in the layout shell read from here,
 * so a palette change lands everywhere at once instead of being re-typed per component.
 */

export const tokens = {
  brand: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
  },
  /** Dark navy scale used by the navigation rail. */
  navy: {
    900: '#0f172a',
    850: '#111c33',
    800: '#1e293b',
  },
  neutral: {
    0: '#ffffff',
    25: '#f8fafc',
    50: '#f5f7fa',
    100: '#eef2f6',
    200: '#e2e8f0',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    900: '#0f172a',
  },
  status: {
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
    info: '#0284c7',
  },
  radius: {
    sm: 8,
    md: 10,
    lg: 12,
  },
  /** Layout metrics shared by Sidebar and Layout. */
  layout: {
    drawerWidth: 248,
    railWidth: 76,
    topBarHeight: 64,
    contentMaxWidth: 1440,
  },
  shadow: {
    card: '0 1px 2px rgba(15, 23, 42, 0.04)',
    raised: '0 4px 16px rgba(15, 23, 42, 0.08)',
  },
} as const;
