import { Injectable } from '@nestjs/common';
import { getDisplayTime } from '@common/utils/time.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import {
  snapshotAmount,
  snapshotName,
} from '@modules/slack/tabs/billing-snapshots/views/billing-snapshots-tab.view';
import { BillingSnapshotExportService } from 'src/billing/services/billing-snapshot-export.service';

// Sends a billing snapshot as a CSV file in a DM with the person who asked;
// the client's name is escaped in the message, which is mrkdwn.
@Injectable()
export class BillingSnapshotDmService {
  public constructor(
    private readonly exportService: BillingSnapshotExportService,
    private readonly dmFileService: DmFileService,
  ) {}

  public async send(user: IUserViewModel, snapshotId: string) {
    const { snapshot, filename, content } = await this.exportService.getCsv(
      snapshotId,
      user,
    );
    const name = snapshotName(snapshot).replace(' · ', ', ');
    const entries = `${snapshot.entryCount} ${snapshot.entryCount === 1 ? 'entry' : 'entries'}`;

    await this.dmFileService.send(user, {
      intro: `📄 Billing snapshot, ${escapeMrkdwn(name)}: ${entries}, ${getDisplayTime(snapshot.total_minutes)}, ${snapshotAmount(snapshot)}.`,
      title: `Billing snapshot, ${name}`,
      filename,
      content,
    });
  }
}
