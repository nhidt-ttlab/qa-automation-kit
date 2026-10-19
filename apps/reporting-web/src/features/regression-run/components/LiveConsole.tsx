import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Alert, Box, Button, Card, CardContent, Chip, Typography } from '@mui/material';
import { ArrowDownwardRounded } from '@mui/icons-material';
import type { RegressionRunStore } from '../store/RegressionRunStore';
import { CONSOLE_TONE_CLASS } from '../types';

const STREAM_LABEL: Record<string, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Ended',
  idle: '',
};

/**
 * The live log pane.
 *
 * This is the ONLY component that dereferences `store.logLines`, and that is load-bearing: MobX
 * re-renders whatever reads an observable, so if the page read the array too, every flush would
 * re-render the header, the summary card and the cancel button along with it. The page passes the
 * store down and reads nothing from it.
 */
export const LiveConsole = observer(({ store }: { store: RegressionRunStore }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const unpinnedAt = useRef(0);

  // The single observable read in this component, and a scalar on purpose: an observable array's
  // reference is stable, so a `[store.logLines]` dependency would silently never re-fire.
  const lineCount = store.logLines.length;

  const handleScroll = (): void => {
    const el = boxRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setPinned((was) => {
      if (was && !atBottom) unpinnedAt.current = lineCount;
      return atBottom;
    });
  };

  useEffect(() => {
    if (pinned && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lineCount, pinned]);

  const newSincePin = Math.max(0, lineCount - unpinnedAt.current);

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <Box className="flex items-center justify-between">
          <Typography variant="h6">Live output</Typography>
          <Box className="flex items-center gap-2">
            {store.streamStatus !== 'idle' && (
              <Chip
                size="small"
                label={STREAM_LABEL[store.streamStatus]}
                color={store.streamStatus === 'open' ? 'success' : 'default'}
                variant="outlined"
              />
            )}
          </Box>
        </Box>

        {store.streamError && <Alert severity="warning">{store.streamError}</Alert>}

        {store.droppedLineCount > 0 && (
          <Typography variant="body2" className="text-gray-500">
            {store.droppedLineCount.toLocaleString()} earlier lines dropped — use “Download full
            log” for the whole file.
          </Typography>
        )}

        <Box className="relative">
          <Box
            ref={boxRef}
            onScroll={handleScroll}
            className="h-[420px] overflow-auto rounded bg-[#0f172a] p-3 font-mono text-xs leading-relaxed"
          >
            {lineCount === 0 ? (
              <Typography variant="body2" className="text-gray-400">
                Waiting for output…
              </Typography>
            ) : (
              store.logLines.map((line) => (
                <div
                  key={line.seq}
                  className={`whitespace-pre-wrap ${CONSOLE_TONE_CLASS[line.tone]}`}
                >
                  {line.text}
                </div>
              ))
            )}
          </Box>

          {!pinned && (
            <Button
              size="small"
              variant="contained"
              startIcon={<ArrowDownwardRounded />}
              className="absolute bottom-3 right-3"
              onClick={() => setPinned(true)}
            >
              Jump to latest{newSincePin > 0 ? ` (${newSincePin} new)` : ''}
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
});
