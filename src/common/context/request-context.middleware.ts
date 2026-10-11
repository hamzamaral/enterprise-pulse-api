import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const headerId = req.headers['x-request-id'];
    const requestId = typeof headerId === 'string' && headerId ? headerId : randomUUID();
    res.setHeader('x-request-id', requestId);

    RequestContext.run({ requestId, ip: req.ip, userAgent: req.headers['user-agent'] }, () =>
      next(),
    );
  }
}
