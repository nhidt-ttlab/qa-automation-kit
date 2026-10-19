import { APP_TITLE } from '@/app/branding';
import { Link } from 'react-router-dom';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
  IconButton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Science as ScienceIcon,
} from '@mui/icons-material';

import { tokens } from '@/app/theme';
import { navItems } from '../nav-items';

export const DRAWER_WIDTH = tokens.layout.drawerWidth;
export const RAIL_WIDTH = tokens.layout.railWidth;

/** Colour roles for the dark rail, kept together so contrast is tuned in one place. */
const rail = {
  bg: tokens.navy[900],
  border: 'rgba(148, 163, 184, 0.14)',
  idle: '#94a3b8',
  idleHover: '#e2e8f0',
  activeBg: 'rgba(59, 130, 246, 0.16)',
  activeText: '#ffffff',
  activeIcon: tokens.brand[400],
  hoverBg: 'rgba(255, 255, 255, 0.06)',
};

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  isMobile: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  isActive: (path: string) => boolean;
}

interface SidebarContentProps {
  showLabels: boolean;
  isActive: (path: string) => boolean;
  onNavigate: () => void;
  showCollapseToggle: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function BrandMark({ showLabels }: { showLabels: boolean }) {
  return (
    <Box
      component={Link}
      to="/"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        height: tokens.layout.topBarHeight,
        px: showLabels ? 2.5 : 0,
        justifyContent: showLabels ? 'flex-start' : 'center',
        textDecoration: 'none',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: `${tokens.radius.md}px`,
          display: 'grid',
          placeItems: 'center',
          background: `linear-gradient(135deg, ${tokens.brand[500]}, ${tokens.brand[700]})`,
          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)',
        }}
      >
        <ScienceIcon sx={{ fontSize: 20, color: '#fff' }} />
      </Box>
      {showLabels && (
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              color: '#fff',
              fontSize: '0.9375rem',
              fontWeight: 700,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}
          >
            {APP_TITLE}
          </Typography>
          <Typography
            sx={{
              color: rail.idle,
              fontSize: '0.6875rem',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
            }}
          >
            ERP Regression QA
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function SidebarContent({
  showLabels,
  isActive,
  onNavigate,
  showCollapseToggle,
  collapsed,
  onToggleCollapsed,
}: SidebarContentProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: rail.bg,
        backgroundImage: `linear-gradient(180deg, ${tokens.navy[900]} 0%, #0b1120 100%)`,
      }}
    >
      <BrandMark showLabels={showLabels} />

      {showLabels && (
        <Typography
          sx={{
            px: 2.5,
            pt: 1,
            pb: 0.5,
            color: tokens.neutral[500],
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
          }}
        >
          Menu
        </Typography>
      )}

      <List component="nav" sx={{ flex: 1, px: 1.25, py: 1 }}>
        {navItems.map(({ path, label, icon: Icon }) => {
          const active = isActive(path);
          const button = (
            <ListItemButton
              key={path}
              component={Link}
              to={path}
              onClick={onNavigate}
              sx={{
                position: 'relative',
                minHeight: 44,
                mb: 0.5,
                borderRadius: `${tokens.radius.md}px`,
                px: showLabels ? 1.5 : 0,
                justifyContent: showLabels ? 'flex-start' : 'center',
                color: active ? rail.activeText : rail.idle,
                bgcolor: active ? rail.activeBg : 'transparent',
                transition: 'background-color 150ms ease, color 150ms ease',
                '&:hover': {
                  bgcolor: active ? rail.activeBg : rail.hoverBg,
                  color: active ? rail.activeText : rail.idleHover,
                },
                // Accent bar marks the active route without shifting the label baseline.
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3,
                  height: active ? 20 : 0,
                  borderRadius: '0 3px 3px 0',
                  bgcolor: tokens.brand[400],
                  transition: 'height 150ms ease',
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 0,
                  mr: showLabels ? 1.75 : 0,
                  color: active ? rail.activeIcon : 'inherit',
                  '& svg': { fontSize: 21 },
                }}
              >
                <Icon />
              </ListItemIcon>
              {showLabels && (
                <ListItemText
                  primary={label}
                  primaryTypographyProps={{
                    fontSize: '0.875rem',
                    fontWeight: active ? 600 : 500,
                    noWrap: true,
                  }}
                />
              )}
            </ListItemButton>
          );

          return showLabels ? (
            button
          ) : (
            <Tooltip key={path} title={label} placement="right" arrow>
              {button}
            </Tooltip>
          );
        })}
      </List>

      {showCollapseToggle && (
        <Box
          sx={{
            borderTop: `1px solid ${rail.border}`,
            display: 'flex',
            justifyContent: showLabels ? 'flex-end' : 'center',
            px: 1.5,
            py: 1,
          }}
        >
          <Tooltip title={collapsed ? 'Expand menu' : 'Collapse menu'} placement="right" arrow>
            <IconButton
              onClick={onToggleCollapsed}
              size="small"
              aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
              sx={{
                color: rail.idle,
                '&:hover': { bgcolor: rail.hoverBg, color: rail.idleHover },
              }}
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}

function Sidebar({
  collapsed,
  onToggleCollapsed,
  isMobile,
  mobileOpen,
  onCloseMobile,
  isActive,
}: SidebarProps) {
  const theme = useTheme();

  if (isMobile) {
    return (
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onCloseMobile}
        ModalProps={{ keepMounted: true }}
        sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
      >
        <SidebarContent
          showLabels
          isActive={isActive}
          onNavigate={onCloseMobile}
          showCollapseToggle={false}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
        />
      </Drawer>
    );
  }

  const railWidth = collapsed ? RAIL_WIDTH : DRAWER_WIDTH;
  const widthTransition = theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  });

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: railWidth,
        flexShrink: 0,
        transition: widthTransition,
        '& .MuiDrawer-paper': {
          width: railWidth,
          boxSizing: 'border-box',
          overflowX: 'hidden',
          transition: widthTransition,
        },
      }}
    >
      <SidebarContent
        showLabels={!collapsed}
        isActive={isActive}
        onNavigate={() => {}}
        showCollapseToggle
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
    </Drawer>
  );
}

export default Sidebar;
