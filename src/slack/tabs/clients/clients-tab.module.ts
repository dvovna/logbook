import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { ClientsModule } from '@modules/clients/clients.module';
import { ChangeClientStatusFormSubmitHandler } from '@modules/slack/tabs/clients/handlers/change-client-status-form-submit.handler';
import { ClientFormSubmitHandler } from '@modules/slack/tabs/clients/handlers/client-form-submit.handler';
import ClientsTabActionHandler from '@modules/slack/tabs/clients/handlers/clients-tab-action.handler';
import ClientModalViewValuesParser from '@modules/slack/tabs/clients/parsers/client-modal-view-values.parser';
import { ClientsTabService } from '@modules/slack/tabs/clients/services/clients-tab.service';
import { ClientsTabView } from '@modules/slack/tabs/clients/views/clients-tab.view';
import { ClientModalView } from '@modules/slack/tabs/clients/views/client-modal.view';


@Module({
  imports: [
    ClientsModule,
    SlackCommonModule,
  ],
  providers: [
    ChangeClientStatusFormSubmitHandler,
    ClientFormSubmitHandler,
    ClientsTabActionHandler,
    ClientModalViewValuesParser,
    ClientsTabService,
    ClientsTabView,
    ClientModalView,
  ],
  exports: [ClientsTabService],
})
export class ClientsTabModule {}
