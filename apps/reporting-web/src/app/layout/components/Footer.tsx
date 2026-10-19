import { APP_TITLE } from '@/app/branding';
import { Box, Typography } from '@mui/material';

import { tokens } from '@/app/theme';

function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        mt: 'auto',
        px: { xs: 2, sm: 3, lg: 4 },
        py: 2.5,
        borderTop: `1px solid ${tokens.neutral[200]}`,
      }}
    >
      <Typography sx={{ fontSize: '0.75rem', color: tokens.neutral[400], textAlign: 'center' }}>
        {APP_TITLE} v0.1.0 &middot; © 2026 All rights reserved
      </Typography>
    </Box>
  );
}

export default Footer;
