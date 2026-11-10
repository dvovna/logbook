import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import EnvironmentVariable from '@common/enums/environment-variable.enum';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

// Bot tokens are stored encrypted (AES-256-GCM with SLACK_TOKEN_ENCRYPTION_KEY)
// as `v1:<iv>:<auth tag>:<ciphertext>`, base64. A leaked database or backup
// then holds no usable tokens. Values without the prefix are tokens stored
// before encryption (Slack's start with `xox`); they are read as they are and
// encrypted by SlackTeamsService.
@Injectable()
export class TokenCipherService {
  private readonly key: Buffer;

  public constructor(config: ConfigService) {
    this.key = Buffer.from(
      config.getOrThrow<string>(EnvironmentVariable.SlackTokenEncryptionKey),
      'base64',
    );
  }

  public isEncrypted(stored: string) {
    return stored.startsWith(`${VERSION}:`);
  }

  public encrypt(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);

    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) =>
        typeof part === 'string' ? part : part.toString('base64'),
      )
      .join(':');
  }

  public decrypt(stored: string): string {
    if (!this.isEncrypted(stored)) {
      return stored;
    }

    const [, iv, tag, ciphertext] = stored
      .split(':')
      .map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
