import {
  clientsLock,
  timesheetLock,
  vacationRequestLock,
  workflowLock,
} from 'src/database/advisory-locks';
import { recordingDatabase } from 'src/database/testing/recording-database';
import { TransactionService } from 'src/database/transaction.service';

const setup = () => {
  const recorded = recordingDatabase();
  const transactions = new TransactionService(recorded.database);

  return { transactions, recorded };
};

describe('TransactionService locks', () => {
  it('takes locks in rank order', async () => {
    const { transactions, recorded } = setup();

    await transactions.transaction(async () => {
      await transactions.lock(vacationRequestLock('r1'));
      await transactions.lock(workflowLock('r1'));
      await transactions.lock(timesheetLock('u1'));
    });

    expect(recorded.queries).toHaveLength(3);
    expect(recorded.parametersOf(0)).toEqual(['vacation-request:r1']);
    expect(recorded.parametersOf(2)).toEqual(['timesheet:u1']);
  });

  it('refuses a lock out of order before sending any statement', async () => {
    const { transactions, recorded } = setup();

    await expect(
      transactions.transaction(async () => {
        await transactions.lock(timesheetLock('u1'));
        await transactions.lock(vacationRequestLock('r1'));
      }),
    ).rejects.toThrow('out of order');

    expect(recorded.queries).toHaveLength(1);
  });

  it('takes locks of one rank in the order of their keys', async () => {
    const { transactions, recorded } = setup();

    await transactions.transaction(async () => {
      await transactions.lock(workflowLock('r1'));
      await transactions.lock(workflowLock('r2'));
    });

    expect(recorded.queries).toHaveLength(2);
  });

  it('refuses a lock of the same rank on an earlier key', async () => {
    const { transactions, recorded } = setup();

    await expect(
      transactions.transaction(async () => {
        await transactions.lock(clientsLock('w2'));
        await transactions.lock(clientsLock('w1'));
      }),
    ).rejects.toThrow('out of order');

    expect(recorded.queries).toHaveLength(1);
  });

  it('takes a key held already without a statement', async () => {
    const { transactions, recorded } = setup();

    await transactions.transaction(async () => {
      await transactions.lock(workflowLock('r1'));
      await transactions.lock(timesheetLock('u1'));
      await transactions.lock(workflowLock('r1'));
    });

    expect(recorded.queries).toHaveLength(2);
  });

  it('lockInOrder sorts the locks by rank, then key', async () => {
    const { transactions, recorded } = setup();

    await transactions.transaction(() =>
      transactions.lockInOrder(
        timesheetLock('u1'),
        workflowLock('r2'),
        workflowLock('r1'),
      ),
    );

    expect(recorded.parametersOf(0)).toEqual(['workflow:r1']);
    expect(recorded.parametersOf(1)).toEqual(['workflow:r2']);
    expect(recorded.parametersOf(2)).toEqual(['timesheet:u1']);
  });

  it('does not remember locks across transactions', async () => {
    const { transactions, recorded } = setup();

    await transactions.transaction(() =>
      transactions.lock(timesheetLock('u1')),
    );
    await transactions.transaction(() =>
      transactions.lock(vacationRequestLock('r1')),
    );

    expect(recorded.queries).toHaveLength(2);
  });

  it('refuses a lock outside a transaction', async () => {
    const { transactions } = setup();

    await expect(transactions.lock(timesheetLock('u1'))).rejects.toThrow(
      'outside a transaction',
    );
  });
});
