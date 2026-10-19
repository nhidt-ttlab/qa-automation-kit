import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import {
  MAX_RESOLUTION_ACTOR_LENGTH,
  MAX_RESOLUTION_COMMENT_LENGTH,
  MAX_RESOLUTION_DECISION_LENGTH,
  MAX_RESOLUTION_NOTE_LENGTH,
  MAX_RESOLUTION_RESOLUTION_LENGTH,
  MAX_RESOLUTION_SUMMARY_LENGTH,
  MAX_RESOLUTION_TITLE_LENGTH,
  MIN_RESOLUTION_REASON_LENGTH,
  RESOLUTION_DIRECT_STATUS_TARGETS,
  RESOLUTION_KIND,
  RESOLUTION_PRIORITY,
  RESOLUTION_TYPE,
} from '@qakit/reporting-shared';
import type {
  ChangeResolutionStatusRequestDto,
  CreateResolutionCommentRequestDto,
  LinkResolutionDefectRequestDto,
  LinkResolutionRedmineRequestDto,
  RecordResolutionDecisionRequestDto,
  RecordResolutionResolutionRequestDto,
  ReopenResolutionIssueRequestDto,
  UpdateResolutionIssueRequestDto,
  VerifyResolutionIssueRequestDto,
} from '@qakit/reporting-shared';

/**
 * Request bodies for the Resolution Queue.
 *
 * `actor` is required on every mutating call. This application has no authentication — no user
 * model, no guards, no session — so the actor is *self-asserted* and stored verbatim for
 * traceability. That limitation is documented in docs/resolution-queue.md rather than papered
 * over with an invented authorization model.
 *
 * class-validator handles shape and length here; the domain service re-validates and additionally
 * rejects control characters, because it is also reachable from the sync path where no pipe runs.
 */

class ActorBody {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_RESOLUTION_ACTOR_LENGTH)
  actor!: string;
}

export class UpdateResolutionIssueBody
  extends ActorBody
  implements UpdateResolutionIssueRequestDto
{
  @IsOptional()
  @IsIn(Object.values(RESOLUTION_KIND))
  kind?: UpdateResolutionIssueRequestDto['kind'];

  /** `null` clears the assignment. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESOLUTION_ACTOR_LENGTH)
  owner?: string | null;

  @IsOptional()
  @IsIn([...Object.values(RESOLUTION_PRIORITY), null])
  priority?: UpdateResolutionIssueRequestDto['priority'];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESOLUTION_SUMMARY_LENGTH)
  user_summary?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESOLUTION_TITLE_LENGTH)
  title?: string;
}

export class ChangeResolutionStatusBody
  extends ActorBody
  implements ChangeResolutionStatusRequestDto
{
  @IsIn(RESOLUTION_DIRECT_STATUS_TARGETS)
  target_status!: ChangeResolutionStatusRequestDto['target_status'];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESOLUTION_NOTE_LENGTH)
  reason?: string;
}

export class CreateResolutionCommentBody
  extends ActorBody
  implements CreateResolutionCommentRequestDto
{
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_RESOLUTION_COMMENT_LENGTH)
  body!: string;
}

export class RecordResolutionDecisionBody
  extends ActorBody
  implements RecordResolutionDecisionRequestDto
{
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_RESOLUTION_DECISION_LENGTH)
  decision!: string;
}

export class RecordResolutionResolutionBody
  extends ActorBody
  implements RecordResolutionResolutionRequestDto
{
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_RESOLUTION_RESOLUTION_LENGTH)
  resolution!: string;

  @IsIn(Object.values(RESOLUTION_TYPE))
  resolution_type!: RecordResolutionResolutionRequestDto['resolution_type'];
}

export class VerifyResolutionIssueBody
  extends ActorBody
  implements VerifyResolutionIssueRequestDto
{
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_RESOLUTION_NOTE_LENGTH)
  verification_note!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  verification_run_id?: string;

  @IsOptional()
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(MIN_RESOLUTION_REASON_LENGTH)
  @MaxLength(MAX_RESOLUTION_NOTE_LENGTH)
  override_reason?: string;
}

export class ReopenResolutionIssueBody
  extends ActorBody
  implements ReopenResolutionIssueRequestDto
{
  @IsString()
  @MinLength(MIN_RESOLUTION_REASON_LENGTH)
  @MaxLength(MAX_RESOLUTION_NOTE_LENGTH)
  reason!: string;
}

export class LinkResolutionDefectBody
  extends ActorBody
  implements LinkResolutionDefectRequestDto
{
  /** `null` unlinks. */
  @IsOptional()
  @IsString()
  defect_signature_id!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESOLUTION_NOTE_LENGTH)
  note?: string;
}

export class LinkResolutionRedmineBody
  extends ActorBody
  implements LinkResolutionRedmineRequestDto
{
  @Type(() => Number)
  @IsInt()
  @Min(1)
  redmine_issue_id!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  redmine_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  redmine_project?: string;

  @IsOptional()
  @IsIn(['created_from_run', 'manually_linked', 'duplicate_of'])
  link_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESOLUTION_NOTE_LENGTH)
  note?: string;
}
