import {
  escapeClipped,
  escapeMrkdwn,
} from '@modules/slack/common/utils/mrkdwn.utils';

describe('escapeMrkdwn', () => {
  it('shows links, mentions and entities as typed', () => {
    expect(escapeMrkdwn('<https://evil.example|Approve> & <!channel>')).toBe(
      '&lt;https://evil.example|Approve&gt; &amp; &lt;!channel&gt;',
    );
  });

  it('leaves other text and formatting alone', () => {
    expect(escapeMrkdwn('Family trip *Rome*, back on Monday')).toBe(
      'Family trip *Rome*, back on Monday',
    );
    expect(escapeMrkdwn(undefined)).toBe('');
  });
});

describe('escapeClipped', () => {
  it('keeps escaped text within `max` characters, never cutting an entity', () => {
    expect(escapeClipped('a&b', 10)).toBe('a&amp;b');
    expect(escapeClipped('&&&', 10)).toBe('&amp;…');
    expect(escapeClipped('&'.repeat(500), 500).length).toBeLessThanOrEqual(500);
  });
});
