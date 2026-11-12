// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Served from GitHub Pages next to the landing page (site/), at /logbook/docs/:
// the Site workflow builds it into site/docs.
export default defineConfig({
  site: 'https://dvovna.github.io',
  base: '/logbook/docs',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Logbook',
      description:
        'Time off and time tracking in Slack: how to use Logbook, run it and build on it.',
      favicon: '/favicon.svg',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/dvovna/logbook',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/dvovna/logbook/edit/development/docs-site/',
      },
      lastUpdated: true,
      sidebar: [
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'For everyone', items: [{ autogenerate: { directory: 'everyone' } }] },
        { label: 'For approvers', items: [{ autogenerate: { directory: 'approvers' } }] },
        { label: 'For HR and admins', items: [{ autogenerate: { directory: 'admins' } }] },
        { label: 'For finance', items: [{ autogenerate: { directory: 'finance' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        { label: 'Self-hosting', items: [{ autogenerate: { directory: 'self-hosting' } }] },
        { label: 'Help', items: [{ autogenerate: { directory: 'help' } }] },
        { label: 'Developers', items: [{ autogenerate: { directory: 'developers' } }] },
      ],
    }),
  ],
});
