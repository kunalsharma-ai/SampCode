import { BadRequestException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import type { UploadedFile } from '../imports/documents';
import { config } from '../config';
import { type MediaService } from './media.service';
import { sendBytes } from '../common/send-bytes';

/** Media library of a survey (Milestone 11). */
export class MediaController {
  constructor(private readonly media: MediaService) {}

  list(user: AuthUser, id: string) {
    return this.media.list(user, id);
  }

  upload(user: AuthUser, id: string, file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach a file');
    return this.media.upload(user, id, file.originalname, file.buffer);
  }

  remove(user: AuthUser, id: string) {
    return this.media.remove(user, id);
  }

  /**
   * Respondents, the studio preview and the CAPI app load media here. The id is the only key, so it is
   * random; files never change under an id, so they can be cached for a year. Supports byte ranges,
   * which browsers need to seek in video.
   */
  async serve(id: string, req: Request, res: Response) {
    const { meta, data } = await this.media.publicFile(id);
    res.setHeader('Content-Type', meta.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', `"${meta.sha256}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.headers['if-none-match'] === `"${meta.sha256}"`) {
      res.status(304).end();
      return;
    }
    sendBytes(req, res, data);
  }
}

/** Express routes of MediaController (mounted by src/http/app.ts). */
export function mediaControllerRoutes(r: Router, c: MediaController, kit: RouteKit) {
  r.get(
    '/api/surveys/:id/media',
    ...kit.route({ controller: 'MediaController', handler: 'list', method: 'get' }, (req) => c.list(req.user as AuthUser, req.params.id)),
  );
  r.post(
    '/api/surveys/:id/media',
    ...kit.route(
      {
        controller: 'MediaController',
        handler: 'upload',
        method: 'post',
        roles: [...CAN_EDIT],
        upload: { field: 'file', ...{ limits: { fileSize: config().MEDIA_MAX_MB * 1024 * 1024, files: 1, fields: 5 } } },
      },
      (req) => c.upload(req.user as AuthUser, req.params.id, req.file as unknown as UploadedFile),
    ),
  );
  r.delete(
    '/api/media/:id',
    ...kit.route({ controller: 'MediaController', handler: 'remove', method: 'delete', status: 204, roles: [...CAN_EDIT] }, (req) =>
      c.remove(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/public/media/:id',
    ...kit.route({ controller: 'MediaController', handler: 'serve', method: 'get', public: true, throttle: false, raw: true }, (req, res) =>
      c.serve(req.params.id, req, res),
    ),
  );
}
