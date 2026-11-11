import { recordingDatabase } from 'src/database/testing/recording-database';
import { TransactionService } from 'src/database/transaction.service';
import { SlackEventReceiptsRepository } from 'src/slack-teams/slack-event-receipts.repository';
import { SlackEventReceiptsService } from 'src/slack-teams/slack-event-receipts.service';

const NOW = new Date('2026-06-17T12:00:00.000Z');

describe('SlackEventReceiptsService', () => {
  let save: jest.Mock;
  let inTransaction: boolean[];

  // The receipts repository on a database that answers `delivery` to the
  // receipt's statement.
  const serviceWith = (
    delivery: { known: boolean; first: boolean } | Error = {
      known: true,
      first: true,
    },
  ) => {
    const recording = recordingDatabase([
      delivery instanceof Error ? delivery : [delivery],
    ]);
    let open = false;
    const transactions = {
      transaction: async <T>(work: () => Promise<T>) => {
        open = true;

        try {
          return await work();
        } finally {
          open = false;
        }
      },
    } as unknown as TransactionService;

    save = jest.fn(async () => {
      inTransaction.push(open);
    });

    return {
      ...recording,
      service: new SlackEventReceiptsService(
        new SlackEventReceiptsRepository(recording.database),
        transactions,
      ),
    };
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    inTransaction = [];
  });

  afterEach(() => jest.useRealTimers());

  it("saves the first delivery's job with its receipt, in one statement and one transaction", async () => {
    const { service, sqlOf, parametersOf } = serviceWith();

    await expect(service.takeOnce('T1', 'Ev1', save)).resolves.toBe(true);

    expect(inTransaction).toEqual([true]);
    expect(sqlOf(0)).toContain('insert into slack_event_receipts');
    expect(sqlOf(0)).toContain('on conflict do nothing');
    expect(parametersOf(0)).toEqual(['T1', 'Ev1', NOW.toISOString()]);
  });

  it('saves nothing for a later delivery', async () => {
    const { service } = serviceWith({ known: true, first: false });

    await expect(service.takeOnce('T1', 'Ev1', save)).resolves.toBe(false);

    expect(save).not.toHaveBeenCalled();
  });

  it('saves the job of an event of a workspace it does not know, as before', async () => {
    const { service } = serviceWith({ known: false, first: false });

    await expect(service.takeOnce('T1', 'Ev1', save)).resolves.toBe(true);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves the job of an event without an ID without a receipt', async () => {
    const { service, queries } = serviceWith();

    await expect(service.takeOnce('T1', undefined, save)).resolves.toBe(true);

    expect(save).toHaveBeenCalledTimes(1);
    expect(queries).toEqual([]);
  });

  it('fails without saving the job when the receipt fails', async () => {
    const { service } = serviceWith(new Error('connection lost'));

    await expect(service.takeOnce('T1', 'Ev1', save)).rejects.toThrow(
      'connection lost',
    );

    expect(save).not.toHaveBeenCalled();
  });

  it('deletes the receipts of every workspace older than an hour', async () => {
    const { service, sqlOf, parametersOf } = serviceWith();

    await service.deleteOld();

    expect(sqlOf(0)).toBe(
      'delete from "slack_event_receipts" where "received_at" < $1',
    );
    expect(parametersOf(0)).toEqual(['2026-06-17T11:00:00.000Z']);
  });
});
