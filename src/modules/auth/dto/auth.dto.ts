import {
  IsEmail,
  IsOptional,
  IsString,
  IsStrongPassword,
  Length,
  MaxLength,
} from 'class-validator';

const STRONG_PASSWORD = {
  minLength: 8,
  minLowercase: 1,
  minUppercase: 1,
  minNumbers: 1,
  minSymbols: 0,
} as const;

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;

  /** 6 digit TOTP code; required when two-factor authentication is enabled. */
  @IsOptional()
  @IsString()
  @Length(6, 6)
  otp?: string;
}

export class LoginResponseDto {
  /** True when the password was correct but a 2FA code is still required. */
  requiresTwoFactor: boolean;
  accessToken?: string;
  /** Access token lifetime in seconds. */
  expiresIn?: number;
}

export class TokenResponseDto {
  accessToken: string;
  expiresIn: number;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsStrongPassword(STRONG_PASSWORD)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsStrongPassword(STRONG_PASSWORD)
  newPassword: string;
}

export class TwoFactorCodeDto {
  @IsString()
  @Length(6, 6)
  code: string;
}

export class TwoFactorSetupResponseDto {
  secret: string;
  otpauthUrl: string;
  /** PNG data URL to render as <img src>. */
  qrCodeDataUrl: string;
}

export class MeBranchDto {
  id: string;
  code: string;
  name: string;
}

export class MeCompanyDto {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  branches: MeBranchDto[];
}

export class MeUserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
  locale: string;
  isSuperAdmin: boolean;
  twoFactorEnabled: boolean;
}

export class MeResponseDto {
  user: MeUserDto;
  companies: MeCompanyDto[];
  activeCompanyId: string;
  activeBranchId: string | null;
  permissions: string[];
}

export class MessageResponseDto {
  message: string;
}
