import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser, JwtPayload } from '../../common/auth/auth-user';
import { RequestContext } from '../../common/context/request-context';
import { AppConfigService } from '../../config/app-config.service';
import { AuthContextService } from './auth-context.service';

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfigService,
    private readonly authContext: AuthContextService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<AuthUser> {
    const user = await this.authContext.resolve(
      payload.sub,
      header(req, 'x-company-id'),
      header(req, 'x-branch-id'),
    );
    RequestContext.set({
      userId: user.id,
      userEmail: user.email,
      companyId: user.companyId,
      branchId: user.branchId ?? undefined,
    });
    return user;
  }
}
