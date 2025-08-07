import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import { ViewsOpenArguments } from '@slack/web-api/dist/types/request/views';
import { IViewStateValues } from 'src/slack/types/slack-view-state-values.interface';

interface IBaseViewService {
  getView(
    triggerId: string,
    metadata: IViewMetadata,
    viewData?: Record<string, unknown>,
  ): ViewsOpenArguments;
  extractData(values: IViewStateValues): Record<string, unknown>;
}

export default IBaseViewService;
