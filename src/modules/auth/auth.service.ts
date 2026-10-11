import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import type { AuthUser, JwtPayload } from '../../common/auth/auth-user';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthContextService } from './auth-context.service';
import type {
  ChangePasswordDto,
  LoginDto,
  LoginResponseDto,
  MeResponseDto,
  ResetPasswordDto,
  TwoFactorSetupResponseDto,
} from './dto/auth.dto';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_TTL_MINUTES = 60;

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly authContext: AuthContextService,
  ) {}

  async login(
    dto: LoginDto,
    meta: ClientMeta,
  ): Promise<{ response: LoginResponseDto; tokens?: IssuedTokens }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (!user) throw new UnauthorizedException('Invalid email or password');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        `Account is locked until ${user.lockedUntil.toISOString()}`,
        HttpStatus.LOCKED,
      );
    }

    if (!(await argon2.verify(user.passwordHash, dto.password))) {
      await this.registerFailedLogin(user);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) throw new ForbiddenException('Account is disabled');

    if (user.twoFactorEnabled) {
      if (!dto.otp) return { response: { requiresTwoFactor: true } };
      if (!user.twoFactorSecret || !authenticator.check(dto.otp, user.twoFactorSecret)) {
        await this.registerFailedLogin(user);
        throw new UnauthorizedException('Invalid two-factor code');
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.record({
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      userEmail: user.email,
    });

    const tokens = await this.issueTokens(user, meta);
    return {
      response: {
        requiresTwoFactor: false,
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
      },
      tokens,
    };
  }

  /**
   * Rotates a refresh token. Presenting an already revoked token means it was stolen or replayed,
   * so the whole token family is revoked and the user must log in again.
   */
  async refresh(rawToken: string | undefined, meta: ClientMeta): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Refresh token reuse detected for user ${stored.userId}`);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');
    if (!stored.user.isActive || stored.user.deletedAt) throw new UnauthorizedException();

    const tokens = await this.issueTokens(stored.user, meta, stored.familyId);
    const next = await this.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: sha256(tokens.refreshToken) },
    });
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: next.id },
    });
    return tokens;
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(authUser: AuthUser): Promise<MeResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: authUser.id } });

    const companies = user.isSuperAdmin
      ? await this.prisma.company.findMany({
          where: { deletedAt: null, isActive: true },
          include: { branches: { where: { deletedAt: null, isActive: true } } },
          orderBy: { name: 'asc' },
        })
      : (
          await this.prisma.userCompany.findMany({
            where: { userId: user.id, company: { deletedAt: null, isActive: true } },
            include: {
              company: { include: { branches: { where: { deletedAt: null, isActive: true } } } },
            },
          })
        ).map((m) => m.company);

    const defaults = await this.prisma.userCompany.findMany({
      where: { userId: user.id, isDefault: true },
      select: { companyId: true },
    });
    const defaultIds = new Set(defaults.map((d) => d.companyId));
    const employee = await this.prisma.employee.findFirst({
      where: { companyId: authUser.companyId, userId: user.id, deletedAt: null },
      select: { id: true },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        locale: user.locale,
        isSuperAdmin: user.isSuperAdmin,
        twoFactorEnabled: user.twoFactorEnabled,
      },
      companies: companies.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        baseCurrency: c.baseCurrency,
        isDefault: defaultIds.has(c.id),
        branches: c.branches.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      })),
      activeCompanyId: authUser.companyId,
      activeBranchId: authUser.branchId,
      permissions: authUser.permissions,
      employeeId: employee?.id ?? null,
    };
  }

  /** Always succeeds so the endpoint cannot be used to discover registered e-mails. */
  async forgotPassword(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, isActive: true },
    });
    if (!user) return;

    const raw = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    });

    const link = `${this.config.get('WEB_APP_URL')}/reset-password?token=${raw}`;
    await this.mail.send({
      to: user.email,
      subject: 'EnterprisePulse — Şifre sıfırlama / Password reset',
      html: `<p>Merhaba ${user.firstName},</p>
<p>Şifrenizi sıfırlamak için <a href="${link}">bu bağlantıya</a> tıklayın. Bağlantı ${RESET_TOKEN_TTL_MINUTES} dakika geçerlidir.</p>
<p>Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>`,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(dto.token) },
    });
    if (!token || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('Reset link is invalid or expired');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: {
          passwordHash: await argon2.hash(dto.password),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(dto.newPassword) },
    });
  }

  async setupTwoFactor(userId: string): Promise<TwoFactorSetupResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.twoFactorEnabled) throw new BadRequestException('Two-factor is already enabled');

    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });
    const otpauthUrl = authenticator.keyuri(user.email, 'EnterprisePulse', secret);
    return { secret, otpauthUrl, qrCodeDataUrl: await toDataURL(otpauthUrl) };
  }

  async enableTwoFactor(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecret || !authenticator.check(code, user.twoFactorSecret)) {
      throw new BadRequestException('Invalid two-factor code');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  }

  async disableTwoFactor(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      !user.twoFactorEnabled ||
      !user.twoFactorSecret ||
      !authenticator.check(code, user.twoFactorSecret)
    ) {
      throw new BadRequestException('Invalid two-factor code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    await this.authContext.invalidateUser(userId);
  }

  private async registerFailedLogin(user: User): Promise<void> {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined,
      },
    });
  }

  private async issueTokens(
    user: User,
    meta: ClientMeta,
    familyId?: string,
  ): Promise<IssuedTokens> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS');
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn });

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() + this.config.get('JWT_REFRESH_TTL_DAYS') * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId: familyId ?? randomUUID(),
        expiresAt: refreshExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500),
      },
    });

    return { accessToken, expiresIn, refreshToken, refreshExpiresAt };
  }
}
