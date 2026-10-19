import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export function PageHeader({
  title,
  backFallback,
  actions,
}: {
  title: string;
  backFallback?: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = () => {
    if (!backFallback) return;
    // react-router assigns the key 'default' only to the entry the app was loaded on,
    // so navigate(-1) would leave the app on a deep link or hard refresh.
    if (location.key !== 'default') {
      navigate(-1);
    } else {
      navigate(backFallback, { replace: true });
    }
  };

  return (
    <Box className="flex items-center justify-between">
      <Box className="flex items-center gap-2">
        {backFallback && (
          <Tooltip title="Go back">
            <IconButton size="small" aria-label="Go back" onClick={handleBack}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
        )}
        <Typography variant="h4" className="font-bold text-dark-900">
          {title}
        </Typography>
      </Box>
      {actions}
    </Box>
  );
}
