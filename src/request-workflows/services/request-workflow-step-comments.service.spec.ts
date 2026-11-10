import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestWorkflowStepCommentsService } from 'src/request-workflows/services/request-workflow-step-comments.service';
import { RequestWorkflowStepCommentsRepository } from 'src/request-workflows/repositories/request-workflow-step-comments.repository';
import { ValidationError } from 'src/common/errors/validation.error';

describe('RequestWorkflowStepCommentsService', () => {
  let repository: Record<'count' | 'create', jest.Mock>;
  let service: RequestWorkflowStepCommentsService;

  const commentParams = {
    requestId: 'request-1',
    slackUserId: 'U_APPROVER',
    slackTeamId: 'slack-team-1',
    stepId: 'step-1',
    stepLevel: 1,
    createdBy: 'approver-1',
  };

  const createError = (comment: string) =>
    service
      .create({ ...commentParams, comment })
      .then(() => null)
      .catch((caught: unknown) => caught);

  beforeEach(() => {
    repository = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((row: object) => row),
    };
    service = new RequestWorkflowStepCommentsService(
      repository as unknown as RequestWorkflowStepCommentsRepository,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );
  });

  it('refuses a blank comment', async () => {
    const error = await createError('   ');

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ field: 'comment' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('refuses a comment over 200 characters', async () => {
    const error = await createError('x'.repeat(201));

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ field: 'comment' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('keeps the comment without the spaces around it', async () => {
    await service.create({ ...commentParams, comment: '  Enjoy!  ' });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ comment: 'Enjoy!' }),
    );
  });
});
