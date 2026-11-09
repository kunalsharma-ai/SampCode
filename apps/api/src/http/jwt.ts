import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import { config } from '../config';

/** Signs and checks session tokens with JWT_SECRET (HMAC). */
export class JwtService {
  private secret() {
    return config().JWT_SECRET;
  }

  signAsync(payload: Record<string, unknown>, options: SignOptions = {}): Promise<string> {
    return new Promise((resolve, reject) =>
      jwt.sign(payload, this.secret(), options, (err, token) =>
        err || !token ? reject(err ?? new Error('Could not sign')) : resolve(token),
      ),
    );
  }

  verifyAsync<T extends object>(token: string, options: VerifyOptions = {}): Promise<T> {
    return new Promise((resolve, reject) =>
      jwt.verify(token, this.secret(), options, (err, decoded) =>
        err || !decoded || typeof decoded === 'string' ? reject(err ?? new Error('Invalid token')) : resolve(decoded as T),
      ),
    );
  }
}
