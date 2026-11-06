import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  SLACK_HANDLER_METADATA,
  ISlackHandlerMeta,
} from '@modules/slack/decorators/slack-handler.decorator';
import { ISlackInteractionHandler } from '@modules/slack/common/handlers/slack-interaction.handler';

interface ISlackHandlerRegistryItem {
  handler: ISlackInteractionHandler;
  allowedRoles?: string[];
}

@Injectable()
export class SlackHandlersRegistry implements OnModuleInit {
  private handlers = new Map<string, ISlackHandlerRegistryItem>();

  public constructor(
    @Inject(DiscoveryService)
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  public onModuleInit() {
    const providers = this.discoveryService.getProviders();

    for (const wrapper of providers) {
      if (!wrapper.metatype) {
        continue;
      }

      const meta = this.reflector.get<ISlackHandlerMeta>(
        SLACK_HANDLER_METADATA,
        wrapper.metatype,
      );

      if (meta) {
        const key = this.buildKey(meta.type, meta.callbackId);
        const instance = wrapper.instance as ISlackInteractionHandler;
        this.handlers.set(key, {
          handler: instance,
          allowedRoles: meta.allowedRoles,
        });
      }
    }
  }

  public getHandler(
    type: string,
    callbackId: string,
  ): ISlackHandlerRegistryItem | undefined {
    return this.handlers.get(this.buildKey(type, callbackId));
  }

  private buildKey(type: string, callbackId: string): string {
    return `${type}:${callbackId}`;
  }
}
