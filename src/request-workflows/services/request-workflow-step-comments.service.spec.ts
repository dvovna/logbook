import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestWorkflowStepCommentsService } from 'src/request-workflows/services/request-workflow-step-comments.service';
import { RequestWorkflowStepCommentsRepository } from 'src/request-workflows/repositories/request-workflow-step-comments.repository';
import { ValidationError } from 'src/common/errors/validation.error';
import { TransactionService } from 'src/database/transaction.service';
import { WorkflowStepCommentEvent } from 'src/request-workflows/enums/workflow-step-comment-event.enum';
import { RequestWorkflowStepCommentAddedEvent } from 'src/request-workflows/events/request-workflow-step-comment.events';

describe('RequestWorkflowStepCommentsService', () => {
  let repository: Record<'count' | 'create', jest.Mock>;
  let emitAsync: jest.Mock;
  let inTransaction: boolean;
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
    inTransaction = false;
    emitAsync = jest.fn(() => {
      expect(inTransaction).toBe(true);

      return Promise.resolve([]);
    });
    service = new RequestWorkflowStepCommentsService(
      repository as unknown as RequestWorkflowStepCommentsRepository,
      { emitAsync } as unknown as EventEmitter2,
      {
        transaction: async <T>(work: () => Promise<T>) => {
          inTransaction = true;

          try {
            return await work();
          } finally {
            inTransaction = false;
          }
        },
      } as unknown as TransactionService,
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

  // Its listeners save the jobs that show it with it.
  it('tells of the comment inside its transaction', async () => {
    await service.create({ ...commentParams, comment: 'Enjoy!' });

    expect(emitAsync).toHaveBeenCalledWith(
      WorkflowStepCommentEvent.Added,
      new RequestWorkflowStepCommentAddedEvent(
        expect.objectContaining({ comment: 'Enjoy!' }),
      ),
    );
  });
});
