import { performance } from 'node:perf_hooks';
import {
  ViewsOpenArguments,
  ViewsPublishArguments,
  ViewsUpdateArguments,
} from '@slack/web-api/dist/types/request/views';
import { FakeSlackApiClient } from 'test/integration/support/fake-slack-api.client';

export interface IShownToSlack {
  method: string;
  // The user a view was published to, or the channel of a message or file.
  to: string;
  callbackId?: string;
  text?: string;
  at: number;
}

const wait = (ms: number) =>
  ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

// The integration tests' fake Slack, with Slack's own time per call
// (`latencyMs`, the network and Slack's work: the fake answers at once), and
// the moment each view, message and file reached Slack, for how long people
// wait for a screen after their click.
export class LoadSlackApiClient extends FakeSlackApiClient {
  public latencyMs = 0;
  public readonly shown: IShownToSlack[] = [];

  public async publishView(args: ViewsPublishArguments, accessToken: string) {
    await wait(this.latencyMs);
    const result = await super.publishView(args, accessToken);

    this.shown.push({
      method: 'views.publish',
      to: args.user_id,
      callbackId: args.view.callback_id,
      at: performance.now(),
    });

    return result;
  }

  public async openView(args: ViewsOpenArguments, accessToken: string) {
    await wait(this.latencyMs);

    return super.openView(args, accessToken);
  }

  public async updateView(args: ViewsUpdateArguments, accessToken: string) {
    await wait(this.latencyMs);

    return super.updateView(args, accessToken);
  }

  public async postMessage(
    args: Parameters<FakeSlackApiClient['postMessage']>[0],
  ) {
    await wait(this.latencyMs);
    const result = await super.postMessage(args);

    this.shown.push({
      method: 'chat.postMessage',
      to: args.channel,
      text: args.text,
      at: performance.now(),
    });

    return result;
  }

  public async updateMessage(
    args: Parameters<FakeSlackApiClient['updateMessage']>[0],
  ) {
    await wait(this.latencyMs);

    return super.updateMessage(args);
  }

  public async uploadFile(
    args: Parameters<FakeSlackApiClient['uploadFile']>[0],
  ) {
    await wait(this.latencyMs);

    return super.uploadFile(args);
  }

  public async shareFile(args: Parameters<FakeSlackApiClient['shareFile']>[0]) {
    await wait(this.latencyMs);
    const result = await super.shareFile(args);

    this.shown.push({
      method: 'files.completeUploadExternal',
      to: args.channelId,
      at: performance.now(),
    });

    return result;
  }
}
