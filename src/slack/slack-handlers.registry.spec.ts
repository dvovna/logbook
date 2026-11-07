import { DiscoveryService, Reflector } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import UserRole from '@common/enums/user-role.enum';
import { ALL_ROLES } from '@common/constants/role-groups';
import {
  ISlackHandlerMeta,
  SlackHandler,
} from '@modules/slack/decorators/slack-handler.decorator';
import {
  READ_ONLY_VIEWS,
  SlackHandlersRegistry,
} from '@modules/slack/slack-handlers.registry';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';

const handlerClass = (meta: ISlackHandlerMeta) => {
  class Handler {
    public handle() {}
  }
  SlackHandler(meta)(Handler);

  return Handler;
};

// A view_submission handler for every view that takes interactions.
const handlerForEveryView = (
  include: (callbackId: ViewCallbackId) => boolean = () => true,
) =>
  Object.values(ViewCallbackId)
    .filter((callbackId) => !READ_ONLY_VIEWS.has(callbackId))
    .filter(include)
    .map((callbackId) =>
      handlerClass({
        callbackId,
        type: 'view_submission',
        allowedRoles: ALL_ROLES,
      }),
    );

const createRegistry = (classes: (new () => unknown)[]) => {
  const providers = classes.map(
    (metatype) =>
      ({
        name: metatype.name,
        metatype,
        instance: new metatype(),
      }) as unknown as InstanceWrapper,
  );
  const discovery = {
    getProviders: () => providers,
  } as unknown as DiscoveryService;

  return new SlackHandlersRegistry(discovery, new Reflector());
};

describe('SlackHandlersRegistry', () => {
  it('finds the handler and its roles by type and callback id', () => {
    const teamsHandler = handlerClass({
      callbackId: ViewCallbackId.TeamsTabView,
      type: 'block_actions',
      allowedRoles: [UserRole.Admin],
    });
    const registry = createRegistry([...handlerForEveryView(), teamsHandler]);

    registry.onModuleInit();

    const item = registry.getHandler(
      'block_actions',
      ViewCallbackId.TeamsTabView,
    );
    expect(item?.handler).toBeInstanceOf(teamsHandler);
    expect(item?.allowedRoles).toEqual([UserRole.Admin]);
    expect(
      registry.getHandler('block_actions', ViewCallbackId.UsersTabView),
    ).toBeUndefined();
  });

  it('refuses two handlers for the same interaction', () => {
    const meta: ISlackHandlerMeta = {
      callbackId: ViewCallbackId.TeamsTabView,
      type: 'block_actions',
      allowedRoles: ALL_ROLES,
    };
    const registry = createRegistry([
      ...handlerForEveryView(),
      handlerClass(meta),
      handlerClass(meta),
    ]);

    expect(() => registry.onModuleInit()).toThrow(
      'Two Slack handlers for block_actions:teams_tab_view',
    );
  });

  it('refuses a handler that allows no role', () => {
    const registry = createRegistry([
      ...handlerForEveryView(),
      handlerClass({
        callbackId: ViewCallbackId.TeamsTabView,
        type: 'block_actions',
        allowedRoles: [],
      }),
    ]);

    expect(() => registry.onModuleInit()).toThrow('allows no role');
  });

  it('refuses to start when a view has no handler', () => {
    const registry = createRegistry(
      handlerForEveryView(
        (callbackId) => callbackId !== ViewCallbackId.TeamFormSubmit,
      ),
    );

    expect(() => registry.onModuleInit()).toThrow(
      'No Slack handler for team_form_submit',
    );
  });
});
