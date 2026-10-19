import { APP_TITLE } from '@/app/branding';
import { Link } from 'react-router-dom';
import { AppBar, Avatar, Box, Breadcrumbs, IconButton, Toolbar, Typography } from '@mui/material';
import { ChevronRight as ChevronRightIcon, Menu as MenuIcon } from '@mui/icons-material';

import { tokens } from '@/app/theme';

interface TopBarProps {
  isMobile: boolean;
  onOpenMobile: () => void;
  title: string;
}

/**
 * Contextual bar above the page. It carries a breadcrumb rather than a second copy of the
 * page heading, so the page's own `h4` stays the only title on screen.
 */
function TopBar({ isMobile, onOpenMobile, title }: TopBarProps) {
  return (
    <AppBar position="sticky">
      <Toolbar sx={{ minHeight: tokens.layout.topBarHeight, gap: 1.5, px: { xs: 2, sm: 3 } }}>
        {isMobile && (
          <IconButton edge="start" onClick={onOpenMobile} aria-label="Open navigation">
            <MenuIcon />
          </IconButton>
        )}

        <Breadcrumbs
          separator={<ChevronRightIcon sx={{ fontSize: 16, color: tokens.neutral[400] }} />}
          aria-label="breadcrumb"
          sx={{ minWidth: 0, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' } }}
        >
          <Typography
            component={Link}
            to="/"
            sx={{
              fontSize: '0.875rem',
              color: tokens.neutral[500],
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              display: { xs: 'none', sm: 'block' },
              '&:hover': { color: tokens.brand[600] },
            }}
          >
            {APP_TITLE}
          </Typography>
          <Typography
            sx={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: tokens.neutral[900],
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </Typography>
        </Breadcrumbs>

        <Box sx={{ flex: 1 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.3 }}>
              QA Team
            </Typography>
            <Typography sx={{ fontSize: '0.6875rem', color: tokens.neutral[500], lineHeight: 1.3 }}>
              Regression
            </Typography>
          </Box>
          <Avatar
            sx={{
              width: 34,
              height: 34,
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.02em',
              bgcolor: tokens.brand[600],
              color: '#fff',
            }}
          >
            QA
          </Avatar>
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default TopBar;
