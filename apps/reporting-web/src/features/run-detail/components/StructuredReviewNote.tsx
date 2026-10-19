import { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  Button,
  Paper,
  Tooltip,
  Alert,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';

export interface StructuredReviewNoteProps {
  note: string;
}

interface ParsedSection {
  title: string;
  rawText: string;
  items: string[];
  ids: string[];
  summary: string;
}

export function parseStructuredNote(note: string) {
  if (!note || typeof note !== 'string') return null;

  const rawLines = note.split('\n');
  const lines = rawLines.map((l) => l.trim()).filter(Boolean);

  // Check if note has structured section markers (either bulleted or direct headers)
  const isStructured = lines.some((l) =>
    /^[-*•]?\s*(OVERVIEW|TỔNG\s*QUAN|UI|PASS|FAIL|BUG|DEFECT|PENDING|NOT[_ ]EVAL|NOT\s+EVALUATED|NEEDS[_ ]CLARIFICATION|BA\s*CHỐT|CẦN\s*BA)/i.test(l)
  );

  if (!isStructured) {
    return { isStructured: false, raw: note };
  }

  let uiStatus = '';
  let passSection: ParsedSection | null = null;
  let failSection: ParsedSection | null = null;
  let pendingSection: ParsedSection | null = null;
  let notEvalSection: ParsedSection | null = null;
  let baSection: ParsedSection | null = null;

  let currentCategory: 'ui' | 'pass' | 'fail' | 'pending' | 'not_eval' | 'ba' | null = null;
  const buffer: Record<string, string[]> = {
    ui: [],
    pass: [],
    fail: [],
    pending: [],
    not_eval: [],
    ba: [],
  };

  for (const line of lines) {
    if (/^[-*•]?\s*(UI|Tổng\s*quan|Overview):?/iu.test(line)) {
      currentCategory = 'ui';
      const clean = line.replace(/^[-*•]?\s*(UI|Tổng\s*quan|Overview):?\s*/iu, '').trim();
      if (clean) buffer.ui.push(clean);
    } else if (/^[-*•]?\s*(?:🟢\s*)?PASS:?/iu.test(line)) {
      currentCategory = 'pass';
      const clean = line.replace(/^[-*•]?\s*(?:🟢\s*)?PASS:?\s*/iu, '').trim();
      if (clean) buffer.pass.push(clean);
    } else if (/^[-*•]?\s*(?:🔴\s*)?(FAIL|BUG\s*DEV|DEFECT|BUG):?/iu.test(line)) {
      currentCategory = 'fail';
      const clean = line.replace(/^[-*•]?\s*(?:🔴\s*)?(FAIL|BUG\s*DEV|DEFECT|BUG):?\s*/iu, '').trim();
      if (clean) buffer.fail.push(clean);
    } else if (/^[-*•]?\s*(?:🟡\s*)?PENDING(\s*\(.*?\))?:?/iu.test(line)) {
      currentCategory = 'pending';
      const clean = line.replace(/^[-*•]?\s*(?:🟡\s*)?PENDING(\s*\(.*?\))?:?\s*/iu, '').trim();
      if (clean) buffer.pending.push(clean);
    } else if (/^[-*•]?\s*(?:[🟡🟠]\s*)?NOT[_ ]EVAL(UATED)?(\s*\(.*?\))?:?/iu.test(line)) {
      currentCategory = 'not_eval';
      const clean = line.replace(/^[-*•]?\s*(?:[🟡🟠]\s*)?NOT[_ ]EVAL(UATED)?(\s*\(.*?\))?:?/iu, '').trim();
      if (clean) buffer.not_eval.push(clean);
    } else if (/^[-*•]?\s*(?:[🟡🟣]\s*)?(CẦN\s*BA\s*CHỐT|BA\s*CHỐT|NEEDS[_ ]CLARIFICATION):?/iu.test(line)) {
      currentCategory = 'ba';
      const clean = line.replace(/^[-*•]?\s*(?:[🟡🟣]\s*)?(CẦN\s*BA\s*CHỐT|BA\s*CHỐT|NEEDS[_ ]CLARIFICATION):?\s*/iu, '').trim();
      if (clean) buffer.ba.push(clean);
    } else if (currentCategory) {
      buffer[currentCategory].push(line);
    }
  }

  const extractIds = (text: string): string[] => {
    const matches = text.match(/#(?:TC_)?[\w-]+/g);
    return matches ? Array.from(new Set(matches)) : [];
  };

  const formatSummary = (items: string[]): string => {
    if (items.length === 0) return '';
    const firstItem = items[0].trim();
    // If the first item only contains IDs and punctuation, remove it from summary as chips display them
    const strippedFirst = firstItem.replace(/#(?:TC_)?[\w-]+/g, '').replace(/[,;\s:-]/g, '');
    const displayItems = (strippedFirst.length === 0 && items.length > 1)
      ? items.slice(1)
      : items;
    return displayItems.join('\n');
  };

  if (buffer.ui.length > 0) {
    uiStatus = buffer.ui.join(' ');
  }

  if (buffer.pass.length > 0) {
    const rawText = buffer.pass.join('\n');
    passSection = {
      title: 'PASS',
      rawText,
      items: buffer.pass,
      ids: extractIds(rawText),
      summary: formatSummary(buffer.pass),
    };
  }

  if (buffer.fail.length > 0) {
    const rawText = buffer.fail.join('\n');
    failSection = {
      title: 'FAIL / DEFECT',
      rawText,
      items: buffer.fail,
      ids: extractIds(rawText),
      summary: formatSummary(buffer.fail),
    };
  }

  if (buffer.pending.length > 0) {
    const rawText = buffer.pending.join('\n');
    const isNone = /^(Không có|Không|None|0|N\/A)\.?$/i.test(rawText.trim());
    if (!isNone) {
      pendingSection = {
        title: 'PENDING',
        rawText,
        items: buffer.pending,
        ids: extractIds(rawText),
        summary: formatSummary(buffer.pending),
      };
    }
  }

  if (buffer.not_eval.length > 0) {
    const rawText = buffer.not_eval.join('\n');
    const isNone = /^(Không có|Không|None|0|N\/A)\.?$/i.test(rawText.trim());
    if (!isNone) {
      notEvalSection = {
        title: 'NOT EVALUATED',
        rawText,
        items: buffer.not_eval,
        ids: extractIds(rawText),
        summary: formatSummary(buffer.not_eval),
      };
    }
  }

  if (buffer.ba.length > 0) {
    const rawText = buffer.ba.join('\n');
    const isNone = /^(Không có|Không|None|0|N\/A)\.?$/i.test(rawText.trim());
    if (!isNone) {
      baSection = {
        title: 'NEEDS CLARIFICATION',
        rawText,
        items: buffer.ba,
        ids: extractIds(rawText),
        summary: formatSummary(buffer.ba),
      };
    }
  }

  return {
    isStructured: true,
    uiStatus,
    passSection,
    failSection,
    pendingSection,
    notEvalSection,
    baSection,
    raw: note,
  };
}

export function StructuredReviewNote({ note }: StructuredReviewNoteProps) {
  const [copied, setCopied] = useState(false);
  const parsed = parseStructuredNote(note);

  if (!parsed || !parsed.isStructured) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          bgcolor: 'grey.50',
          borderColor: 'grey.200',
          whiteSpace: 'pre-line',
          fontFamily: 'inherit',
        }}
      >
        <Typography variant="body2" color="text.primary">
          {note}
        </Typography>
      </Paper>
    );
  }

  const { uiStatus, passSection, failSection, pendingSection, notEvalSection, baSection } = parsed;

  const handleCopyPassIds = () => {
    if (!passSection || passSection.ids.length === 0) return;
    const textToCopy = passSection.ids.join(', ');
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isUiOk = uiStatus && !/không đạt|bug|lỗi js|crash|failed/i.test(uiStatus);

  const getSectionCount = (section: ParsedSection | null): number => {
    if (!section) return 0;
    if (section.ids.length > 0) return section.ids.length;
    const match = section.rawText.match(/^(\d+)(?:\/\d+)?/);
    if (match) return parseInt(match[1], 10);
    return 0;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
      {/* 1. Metric Badges & Action */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          p: 1.2,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          {passSection && (
            <Chip
              icon={<CheckCircleOutlineIcon fontSize="small" />}
              label={`${getSectionCount(passSection)} PASS`}
              color="success"
              size="small"
              sx={{ fontWeight: 700 }}
            />
          )}
          {failSection && (
            <Chip
              icon={<ErrorOutlineIcon fontSize="small" />}
              label={`${getSectionCount(failSection)} FAIL`}
              color="error"
              size="small"
              sx={{ fontWeight: 700 }}
            />
          )}
          {pendingSection && (
            <Chip
              icon={<PauseCircleOutlineIcon fontSize="small" sx={{ color: '#854d0e !important' }} />}
              label={`${getSectionCount(pendingSection)} PENDING`}
              size="small"
              sx={{
                bgcolor: '#fef9c3',
                color: '#854d0e',
                border: '1px solid #fef08a',
                fontWeight: 700,
              }}
            />
          )}
          {notEvalSection && (
            <Chip
              icon={<HelpOutlineIcon fontSize="small" sx={{ color: '#475569 !important' }} />}
              label={`${getSectionCount(notEvalSection)} NOT EVALUATED`}
              sx={{
                bgcolor: '#f1f5f9',
                color: '#334155',
                borderColor: '#cbd5e1',
                border: '1px solid',
                fontWeight: 700,
              }}
              size="small"
            />
          )}
          {baSection && (
            <Chip
              icon={<HelpOutlineIcon fontSize="small" sx={{ color: '#86198f !important' }} />}
              label={`${getSectionCount(baSection)} NEEDS CLARIFICATION`}
              size="small"
              sx={{
                bgcolor: '#fae8ff',
                color: '#86198f',
                border: '1px solid #f5d0fe',
                fontWeight: 700,
              }}
            />
          )}
        </Box>

        {passSection && passSection.ids.length > 0 && (
          <Tooltip title="Copy all passed checklist IDs">
            <Button
              size="small"
              variant="outlined"
              color="success"
              startIcon={copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              onClick={handleCopyPassIds}
              sx={{ textTransform: 'none', py: 0.2, px: 1, fontWeight: 600 }}
            >
              {copied ? 'Copied!' : `Copy ${passSection.ids.length} PASS IDs`}
            </Button>
          </Tooltip>
        )}
      </Box>

      {/* 2. UI Execution Status */}
      {uiStatus && (
        <Alert
          severity={isUiOk ? 'success' : 'warning'}
          icon={isUiOk ? <CheckCircleOutlineIcon /> : <WarningAmberIcon />}
          sx={{ py: 0.5, px: 1.5, '& .MuiAlert-message': { width: '100%' } }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            <strong>OVERVIEW:</strong> {uiStatus}
          </Typography>
        </Alert>
      )}

      {/* 3. PASS Section */}
      {passSection && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderLeft: '4px solid #16a34a',
            bgcolor: '#f0fdf4',
            borderColor: '#bbf7d0',
          }}
        >
          <Typography variant="subtitle2" sx={{ color: '#15803d', fontWeight: 700, mb: 0.8 }}>
            PASS ({getSectionCount(passSection)})
          </Typography>
          {passSection.ids.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              {passSection.ids.map((id) => (
                <Chip
                  key={id}
                  label={id}
                  size="small"
                  sx={{
                    bgcolor: '#dcfce7',
                    color: '#166534',
                    fontWeight: 600,
                    height: 22,
                    fontSize: '0.75rem',
                  }}
                />
              ))}
            </Box>
          )}
          <Typography variant="body2" sx={{ color: '#14532d', whiteSpace: 'pre-line' }}>
            {passSection.summary}
          </Typography>
        </Paper>
      )}

      {/* 4. FAIL Section */}
      {failSection && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderLeft: '4px solid #dc2626',
            bgcolor: '#fef2f2',
            borderColor: '#fecaca',
          }}
        >
          <Typography variant="subtitle2" sx={{ color: '#b91c1c', fontWeight: 700, mb: 0.8 }}>
            FAIL ({getSectionCount(failSection)})
          </Typography>
          {failSection.ids.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              {failSection.ids.map((id) => (
                <Chip
                  key={id}
                  label={id}
                  size="small"
                  sx={{
                    bgcolor: '#fee2e2',
                    color: '#991b1b',
                    fontWeight: 600,
                    height: 22,
                    fontSize: '0.75rem',
                  }}
                />
              ))}
            </Box>
          )}
          <Typography variant="body2" sx={{ color: '#7f1d1d', whiteSpace: 'pre-line' }}>
            {failSection.summary}
          </Typography>
        </Paper>
      )}

      {/* 5. PENDING Section */}
      {pendingSection && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderLeft: '4px solid #eab308',
            bgcolor: '#fefce8',
            borderColor: '#fef08a',
          }}
        >
          <Typography variant="subtitle2" sx={{ color: '#a16207', fontWeight: 700, mb: 0.8 }}>
            PENDING ({getSectionCount(pendingSection)})
          </Typography>
          {pendingSection.ids.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              {pendingSection.ids.map((id) => (
                <Chip
                  key={id}
                  label={id}
                  size="small"
                  sx={{
                    bgcolor: '#fef9c3',
                    color: '#854d0e',
                    fontWeight: 600,
                    height: 22,
                    fontSize: '0.75rem',
                  }}
                />
              ))}
            </Box>
          )}
          <Typography variant="body2" sx={{ color: '#713f12', whiteSpace: 'pre-line' }}>
            {pendingSection.summary}
          </Typography>
        </Paper>
      )}

      {/* 6. NOT EVALUATED Section */}
      {notEvalSection && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderLeft: '4px solid #64748b',
            bgcolor: '#f8fafc',
            borderColor: '#e2e8f0',
          }}
        >
          <Typography variant="subtitle2" sx={{ color: '#334155', fontWeight: 700, mb: 0.8 }}>
            NOT EVALUATED ({getSectionCount(notEvalSection)})
          </Typography>
          {notEvalSection.ids.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              {notEvalSection.ids.map((id) => (
                <Chip
                  key={id}
                  label={id}
                  size="small"
                  sx={{
                    bgcolor: '#f1f5f9',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    fontWeight: 600,
                    height: 22,
                    fontSize: '0.75rem',
                  }}
                />
              ))}
            </Box>
          )}
          <Typography variant="body2" sx={{ color: '#1e293b', whiteSpace: 'pre-line' }}>
            {notEvalSection.summary}
          </Typography>
        </Paper>
      )}

      {/* 7. NEEDS CLARIFICATION Section */}
      {baSection && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderLeft: '4px solid #a855f7',
            bgcolor: '#faf5ff',
            borderColor: '#e9d5ff',
          }}
        >
          <Typography variant="subtitle2" sx={{ color: '#7e22ce', fontWeight: 700, mb: 0.8 }}>
            NEEDS CLARIFICATION ({getSectionCount(baSection)})
          </Typography>
          {baSection.ids.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              {baSection.ids.map((id) => (
                <Chip
                  key={id}
                  label={id}
                  size="small"
                  sx={{
                    bgcolor: '#f3e8ff',
                    color: '#6b21a8',
                    fontWeight: 600,
                    height: 22,
                    fontSize: '0.75rem',
                  }}
                />
              ))}
            </Box>
          )}
          <Typography variant="body2" sx={{ color: '#581c87', whiteSpace: 'pre-line' }}>
            {baSection.summary}
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
