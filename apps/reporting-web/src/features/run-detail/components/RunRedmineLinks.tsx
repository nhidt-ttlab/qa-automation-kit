import { Card, CardHeader, CardContent, Chip, Tooltip, Typography } from '@mui/material';
import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';

type RedmineLinks = NonNullable<TestRunDetailResponseDto['redmine_links']>;

const INHERITED_HINT =
  'Filed from another run reproducing the same defect — this failure is already reported.';

export function RunRedmineLinks({ links }: { links: RedmineLinks }) {
  if (!links.length) return null;

  return (
    <Card>
      <CardHeader title={`Redmine Tickets (${links.length})`} />
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {links.map((link) => (
            <Tooltip
              key={link.id}
              title={link.created_from_this_run ? '' : INHERITED_HINT}
            >
              <Chip
                size="small"
                label={`Redmine #${link.redmine_issue_id}`}
                // `redmine_url` is nullable. Spreading the anchor props only when there is
                // one keeps a URL-less row a plain chip: passing component="a" with an
                // undefined href still renders an <a>, which reads as a dead link.
                {...(link.redmine_url
                  ? {
                      component: 'a' as const,
                      href: link.redmine_url,
                      clickable: true,
                      target: '_blank',
                      rel: 'noreferrer',
                    }
                  : {})}
                variant={link.created_from_this_run ? 'filled' : 'outlined'}
                color={link.created_from_this_run ? 'error' : 'default'}
              />
            </Tooltip>
          ))}
        </div>
        {links.some((link) => !link.created_from_this_run) && (
          <Typography variant="caption" className="text-gray-500">
            Outlined tickets were filed from another run with the same defect.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
