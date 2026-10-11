import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public } from '../../common/decorators';
import { AppConfigService } from '../../config/app-config.service';
import { AuthService, ClientMeta, IssuedTokens } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResponseDto,
  MeResponseDto,
  MessageResponseDto,
  ResetPasswordDto,
  TokenResponseDto,
  TwoFactorCodeDto,
  TwoFactorSetupResponseDto,
} from './dto/auth.dto';

const REFRESH_COOKIE = 'ep_refresh';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const { response, tokens } = await this.auth.login(dto, this.meta(req));
    if (tokens) this.setRefreshCookie(res, tokens);
    return response;
  }

  /** Uses the httpOnly refresh cookie; returns a new access token and rotates the cookie. */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    try {
      const tokens = await this.auth.refresh(this.readRefreshCookie(req), this.meta(req));
      this.setRefreshCookie(res, tokens);
      return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    await this.auth.logout(this.readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { message: 'Logged out' };
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOkResponse({ type: MeResponseDto })
  me(@CurrentUser() user: AuthUser): Promise<MeResponseDto> {
    return this.auth.me(user);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    await this.auth.forgotPassword(dto.email);
    return { message: 'If the e-mail is registered, a reset link has been sent' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponseDto> {
    await this.auth.resetPassword(dto);
    return { message: 'Password updated' };
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    await this.auth.changePassword(userId, dto);
    return { message: 'Password updated' };
  }

  @ApiBearerAuth()
  @Post('2fa/setup')
  @ApiOkResponse({ type: TwoFactorSetupResponseDto })
  setupTwoFactor(@CurrentUser('id') userId: string): Promise<TwoFactorSetupResponseDto> {
    return this.auth.setupTwoFactor(userId);
  }

  @ApiBearerAuth()
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async enableTwoFactor(
    @CurrentUser('id') userId: string,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<MessageResponseDto> {
    await this.auth.enableTwoFactor(userId, dto.code);
    return { message: 'Two-factor authentication enabled' };
  }

  @ApiBearerAuth()
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async disableTwoFactor(
    @CurrentUser('id') userId: string,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<MessageResponseDto> {
    await this.auth.disableTwoFactor(userId, dto.code);
    return { message: 'Two-factor authentication disabled' };
  }

  private meta(req: Request): ClientMeta {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  private readRefreshCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[REFRESH_COOKIE];
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
    };
  }

  private setRefreshCookie(res: Response, tokens: IssuedTokens): void {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...this.cookieOptions(),
      expires: tokens.refreshExpiresAt,
    });
  }
}
