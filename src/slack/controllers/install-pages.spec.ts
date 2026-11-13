import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const PUBLIC = join(__dirname, '..', '..', '..', 'public');
const page = (name: string) => readFileSync(join(PUBLIC, name), 'utf8');

// The pages the OAuth redirect ends on (SlackOauthController), served from
// public/ as they are.
describe('the pages an install ends on', () => {
  it.each([
    ['success.html', 'Logbook is installed'],
    ['install-failed.html', 'Logbook was not installed'],
  ])('%s has its title and loads nothing from another host', (name, title) => {
    const html = page(name);

    expect(html).toContain(`<title>${title}</title>`);
    expect(html).not.toMatch(
      /<(script|img|link)[^>]+(src|href)="(https?:)?\/\//,
    );
    expect(html).toContain('<link rel="stylesheet" href="/page.css">');
    expect(existsSync(join(PUBLIC, 'page.css'))).toBe(true);
    expect(existsSync(join(PUBLIC, 'favicon.svg'))).toBe(true);
    expect(page('page.css')).not.toMatch(/url\(|@import/);
  });

  it('success.html knows every kind of install the redirect names', () => {
    const html = page('success.html');

    expect(html).toMatch(/again: \{/);
    expect(html).toMatch(/restored: \{/);
    expect(html).toContain("query.get('installed')");
    // IDs only, never text from the address.
    expect(html).toContain('/^T[A-Z0-9]{2,20}$/.test(team)');
    expect(html).toContain('/^A[A-Z0-9]{2,20}$/.test(app)');
    expect(html).not.toMatch(/innerHTML|document\.write/);
  });

  it('install-failed.html has a text for every reason the redirect names', () => {
    const html = page('install-failed.html');

    for (const reason of ['canceled', 'expired', 'workspace']) {
      expect(html).toMatch(new RegExp(`\\b${reason}: '`));
    }

    expect(html).not.toMatch(/innerHTML|document\.write/);
  });
});
