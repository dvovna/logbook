import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import UserRole from '@common/enums/user-role.enum';
import {
  SLACK_HANDLER_METADATA,
  ISlackHandlerMeta,
} from '@modules/slack/decorators/slack-handler.decorator';
import { ISlackInteractionHandler } from '@modules/slack/common/handlers/slack-interaction.handler';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';

interface ISlackHandlerRegistryItem {
  handler: ISlackInteractionHandler;
  allowedRoles: readonly UserRole[];
}

// Modals that only show something: a Close button, no inputs and no buttons,
// so Slack never sends an interaction for them.
export const READ_ONLY_VIEWS: ReadonlySet<ViewCallbackId> = new Set([
  ViewCallbackId.ViewUserVacationUsage,
  ViewCallbackId.ViewVacationRequestDetails,
  ViewCallbackId.CsvImportInstructions,
]);

// Finds the @SlackHandler classes at startup. A mistake here would show up
// only when somebody clicks, as a dead button or the wrong handler, so the app
// refuses to start instead: two handlers for one interaction, a handler open
// to no role, or a view whose handler is missing (not registered as a
// provider in its module).
@Injectable()
export class SlackHandlersRegistry implements OnModuleInit {
  private handlers = new Map<string, ISlackHandlerRegistryItem>();

  public constructor(
    @Inject(DiscoveryService)
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  public onModuleInit() {
    const handledViews = new Set<string>();

    for (const wrapper of this.discoveryService.getProviders()) {
      if (!wrapper.metatype) {
        continue;
      }

      const meta = this.reflector.get<ISlackHandlerMeta | undefined>(
        SLACK_HANDLER_METADATA,
        wrapper.metatype,
      );

      if (meta) {
        this.register(
          meta,
          wrapper.instance as ISlackInteractionHandler,
          wrapper.name,
        );
        handledViews.add(meta.callbackId);
      }
    }

    const unhandled = Object.values(ViewCallbackId).filter(
      (callbackId) =>
        !handledViews.has(callbackId) && !READ_ONLY_VIEWS.has(callbackId),
    );

    if (unhandled.length) {
      throw new Error(
        `No Slack handler for ${unhandled.join(', ')}: register the handler as a provider, or add a view without interactions to READ_ONLY_VIEWS`,
      );
    }
  }

  public getHandler(
    type: string,
    callbackId: string,
  ): ISlackHandlerRegistryItem | undefined {
    return this.handlers.get(this.buildKey(type, callbackId));
  }

  private register(
    meta: ISlackHandlerMeta,
    handler: ISlackInteractionHandler,
    name: string,
  ) {
    const key = this.buildKey(meta.type, meta.callbackId);

    if (this.handlers.has(key)) {
      throw new Error(`Two Slack handlers for ${key}, one of them ${name}`);
    }

    if (!meta.allowedRoles?.length) {
      throw new Error(`Slack handler ${name} (${key}) allows no role`);
    }

    this.handlers.set(key, { handler, allowedRoles: meta.allowedRoles });
  }

  private buildKey(type: string, callbackId: string): string {
    return `${type}:${callbackId}`;
  }
}
