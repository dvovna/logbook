import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';
import { ClientsTabViewActionId } from '@modules/slack/tabs/clients/enums/clients-tab-view-actions-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { textOf } from './support/block-kit';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// Home → Time & Billing → Clients.
const CLIENTS_TAB = [
  AdminNavigationActionId.ManageTimeAndBilling,
  AdminNavigationActionId.ManageClients,
];

describe('Clients', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin });
  });

  describe('creating a client', () => {
    const openCreateModal = async (user: Tables<'users'>) => {
      const clientsTab = await openAppHomeTab(t, workspace, user, CLIENTS_TAB);

      return openModalFrom(
        t,
        workspace,
        user,
        clientsTab,
        ClientsTabViewActionId.AddClient,
      );
    };

    it('creates a client and lists it in the Clients tab', async () => {
      const modal = await openCreateModal(admin);

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, modal, {
          name: 'Acme',
          description: 'Main customer',
        })
        .expect(200);

      expect(textOf(response.body.view)).toContain(
        "Client 'Acme' was created successfully!",
      );
      expect(await workspace.rows('clients')).toEqual([
        expect.objectContaining({
          name: 'Acme',
          description: 'Main customer',
          created_by: admin.id,
          archived_at: null,
          archived_by: null,
        }),
      ]);
      expect(textOf(await publishedHome(t, workspace, admin, since))).toContain(
        '*Acme*',
      );
    });

    it('requires a name', async () => {
      const modal = await openCreateModal(admin);

      const response = await t.slack
        .submitView(workspace, admin, modal, { name: '' })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: { name_block: 'Client name is required' },
      });
      expect(await workspace.rows('clients')).toEqual([]);
    });

    it('refuses a second client with the same name', async () => {
      await workspace.addClient({ name: 'Acme' });
      const modal = await openCreateModal(admin);

      const response = await t.slack
        .submitView(workspace, admin, modal, { name: 'Acme' })
        .expect(200);

      expect(textOf(response.body.view)).toContain(
        'Client with same name already exists.',
      );
      expect(await workspace.rows('clients')).toHaveLength(1);
    });

    it('shows a manager the clients without ways to change them', async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });
      await workspace.addClient({ name: 'Acme' });

      const clientsTab = textOf(
        await openAppHomeTab(t, workspace, manager, CLIENTS_TAB),
      );

      expect(clientsTab).toContain('*Acme*');
      expect(clientsTab).not.toContain(ClientsTabViewActionId.AddClient);
      expect(clientsTab).not.toContain(ClientsTabViewActionId.ManageClientMenu);
    });

    it("refuses a manager's client form", async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });
      const modal = await openCreateModal(admin);

      const response = await t.slack
        .submitView(workspace, manager, modal, { name: 'Acme' })
        .expect(200);

      expect(textOf(response.body.view)).toContain('not allowed');
      expect(await workspace.rows('clients')).toEqual([]);
    });
  });

  describe('archiving a client', () => {
    // The confirmation behind "Archive Client" / "Restore Client" in the
    // client's menu.
    const openConfirmation = (clientsTab: View, client: Tables<'clients'>) =>
      openModalFrom(
        t,
        workspace,
        admin,
        clientsTab,
        ClientsTabViewActionId.ManageClientMenu,
        `${ClientsTabViewActionId.ArchiveClient}:${client.id}`,
      );

    it('archives a client and lists it only with archived clients included', async () => {
      const client = await workspace.addClient({ name: 'Acme' });
      const clientsTab = await openAppHomeTab(t, workspace, admin, CLIENTS_TAB);

      const confirmation = await openConfirmation(clientsTab, client);
      expect(textOf(confirmation)).toContain(
        'The client *Acme* will be archived',
      );

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, confirmation)
        .expect(200);

      expect(textOf(response.body.view)).toContain(
        "Client 'Acme' has been successfully archived.",
      );
      expect(await workspace.row('clients', client.id)).toMatchObject({
        archived_at: expect.any(String),
        archived_by: admin.id,
      });

      const updatedTab = await publishedHome(t, workspace, admin, since);
      expect(textOf(updatedTab)).not.toContain('*Acme*');

      const withArchived = await actOnTab(
        t,
        workspace,
        admin,
        updatedTab,
        ClientsTabViewActionId.IncludeArchivedClients,
        YesNoValue.Yes,
      );
      expect(textOf(withArchived)).toContain('*Acme*');
      expect(textOf(withArchived)).toContain('Restore Client');
      expect(textOf(withArchived)).not.toContain('Edit Client');
    });

    it('restores an archived client', async () => {
      const client = await workspace.addClient({
        name: 'Acme',
        archived_at: new Date().toISOString(),
        archived_by: admin.id,
      });
      const clientsTab = await actOnTab(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, CLIENTS_TAB),
        ClientsTabViewActionId.IncludeArchivedClients,
        YesNoValue.Yes,
      );

      const confirmation = await openConfirmation(clientsTab, client);
      expect(textOf(confirmation)).toContain(
        'The client *Acme* will be restored',
      );

      const response = await t.slack
        .submitView(workspace, admin, confirmation)
        .expect(200);

      expect(textOf(response.body.view)).toContain(
        "Client 'Acme' has been successfully restored.",
      );
      expect(await workspace.row('clients', client.id)).toMatchObject({
        archived_at: null,
        archived_by: null,
      });
    });
  });
});
