import { APP_TITLE } from '@/app/branding';
/**
 * Main Layout Component
 * Left sidebar navigation shell (collapsible rail on desktop, overlay drawer on mobile)
 */

import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Footer from './components/Footer';
import { navItems } from './nav-items';
import { tokens } from '@/app/theme';

interface LayoutProps {
  children: React.ReactNode;
}

const COLLAPSE_STORAGE_KEY = 'qakit-reporting.sidebar-collapsed';

function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1',
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const currentPage =
    navItems.find((item) => isActive(item.path)) ??
    (location.pathname.startsWith('/test-cases/')
      ? navItems.find((item) => item.path === '/')
      : undefined);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        isMobile={isMobile}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        isActive={isActive}
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <TopBar
          isMobile={isMobile}
          onOpenMobile={() => setMobileOpen(true)}
          title={currentPage?.label || APP_TITLE}
        />

        <Box
          component="main"
          sx={{
            flex: 1,
            width: '100%',
            maxWidth: tokens.layout.contentMaxWidth,
            mx: 'auto',
            px: { xs: 2, sm: 3, lg: 4 },
            py: { xs: 2.5, sm: 3, lg: 4 },
          }}
        >
          {children}
        </Box>

        <Footer />
      </Box>
    </Box>
  );
}

export default Layout;
