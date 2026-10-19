import type { ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import InboxIcon from '@mui/icons-material/Inbox';

export function LoadingState() {
  return (
    <Box className="flex items-center justify-center py-20">
      <CircularProgress />
    </Box>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      severity="error"
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Box className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <InboxIcon className="text-gray-300" sx={{ fontSize: 48 }} />
      <Typography variant="subtitle1" className="font-semibold text-gray-600">
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" className="text-gray-400 max-w-sm">
          {description}
        </Typography>
      )}
    </Box>
  );
}

export function AsyncSection({
  isLoading,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (isEmpty) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <>{children}</>;
}
