import { Card, CardHeader, CardContent, Chip, Link as MuiLink } from '@mui/material';
import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';

type RelatedEntities = NonNullable<TestRunDetailResponseDto['related_entities']>;
type ArtifactLinks = NonNullable<TestRunDetailResponseDto['artifact_links']>;

export function RunRelatedEntities({ entities }: { entities: RelatedEntities }) {
  if (!entities.length) return null;

  return (
    <Card>
      <CardHeader title="Related Entities" />
      <CardContent className="flex flex-wrap gap-2">
        {entities.map((entity) => (
          <Chip
            key={`${entity.type}-${entity.id}`}
            label={`${entity.type}: ${entity.label ?? entity.id}`}
            size="small"
            variant="outlined"
          />
        ))}
      </CardContent>
    </Card>
  );
}

export function RunArtifactLinks({ artifacts }: { artifacts: ArtifactLinks }) {
  if (!artifacts.length) return null;

  return (
    <Card>
      <CardHeader title="Artifacts" />
      <CardContent className="space-y-1">
        {artifacts.map((artifact, index) => (
          <div key={`${artifact.type}-${index}`} className="text-sm">
            <Chip label={artifact.type} size="small" variant="outlined" className="mr-2" />
            {artifact.url ? (
              <MuiLink href={artifact.url} target="_blank" rel="noreferrer" underline="hover">
                {artifact.label}
              </MuiLink>
            ) : (
              artifact.label
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
