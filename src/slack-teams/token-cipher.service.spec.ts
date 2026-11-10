import { ConfigService } from '@nestjs/config';
import { TokenCipherService } from 'src/slack-teams/token-cipher.service';

const cipherWithKey = (fill: number) =>
  new TokenCipherService({
    getOrThrow: () => Buffer.alloc(32, fill).toString('base64'),
  } as unknown as ConfigService);

describe('TokenCipherService', () => {
  const cipher = cipherWithKey(1);

  it('encrypts a token so that only the key reads it back', () => {
    const stored = cipher.encrypt('xoxb-123-secret');

    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('xoxb');
    expect(cipher.encrypt('xoxb-123-secret')).not.toBe(stored);
    expect(cipher.decrypt(stored)).toBe('xoxb-123-secret');
    expect(() => cipherWithKey(2).decrypt(stored)).toThrow();
  });

  it('refuses a changed ciphertext', () => {
    const [version, iv, tag, data] = cipher.encrypt('xoxb-1').split(':');
    const changed = Buffer.from(data, 'base64');
    changed[0] ^= 1;

    expect(() =>
      cipher.decrypt([version, iv, tag, changed.toString('base64')].join(':')),
    ).toThrow();
  });

  it('reads a token stored before encryption as it is', () => {
    expect(cipher.isEncrypted('xoxb-legacy')).toBe(false);
    expect(cipher.decrypt('xoxb-legacy')).toBe('xoxb-legacy');
  });
});
