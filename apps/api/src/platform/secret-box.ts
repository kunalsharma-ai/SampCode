import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config';

export abstract class SecretBox {
  abstract seal(plain: string): string;
  abstract open(sealed: string): string;
}

/** The AES key derived from a master secret (SECRETS_KEY, or JWT_SECRET in development). */
export const secretBoxKey = (master: string) => createHash('sha256').update(`zapx-secret-box:${master}`).digest();

export class LocalSecretBox extends SecretBox {
  private readonly key: Buffer;

  /** `master` is for code that runs before the configuration can be read (installation-secrets.ts). */
  constructor(master?: string) {
    super();
    if (master) this.key = secretBoxKey(master);
    else {
      const cfg = config();
      this.key = secretBoxKey(cfg.SECRETS_KEY ?? cfg.JWT_SECRET);
    }
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [v, iv, tag, data] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unsupported sealed secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
