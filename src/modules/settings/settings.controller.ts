import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import {
  CreateCurrencyDto,
  CreateExchangeRateDto,
  CreateTaxRateDto,
  CreateUnitDto,
  CurrencyDto,
  ExchangeRateDto,
  ExchangeRateQueryDto,
  SettingDto,
  TaxRateDto,
  UnitDto,
  UpdateCurrencyDto,
  UpdateTaxRateDto,
  UpdateUnitDto,
  UpsertSettingDto,
} from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth()
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // Currencies are reference data every authenticated user may read.
  @Get('currencies')
  @ApiOkResponse({ type: [CurrencyDto] })
  findCurrencies() {
    return this.settings.findCurrencies();
  }

  @Post('currencies')
  @RequirePermissions('settings:update')
  @ApiOkResponse({ type: CurrencyDto })
  createCurrency(@CurrentUser() user: AuthUser, @Body() dto: CreateCurrencyDto) {
    return this.settings.createCurrency(user, dto);
  }

  @Patch('currencies/:code')
  @RequirePermissions('settings:update')
  @ApiOkResponse({ type: CurrencyDto })
  updateCurrency(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: UpdateCurrencyDto,
  ) {
    return this.settings.updateCurrency(user, code, dto);
  }

  @Get('exchange-rates')
  @RequirePermissions('settings:read')
  @ApiOkResponse({ type: PaginatedResponseDto(ExchangeRateDto) })
  findExchangeRates(@Query() query: ExchangeRateQueryDto) {
    return this.settings.findExchangeRates(query);
  }

  @Post('exchange-rates')
  @RequirePermissions('settings:update')
  @ApiOkResponse({ type: ExchangeRateDto })
  upsertExchangeRate(@Body() dto: CreateExchangeRateDto) {
    return this.settings.upsertExchangeRate(dto);
  }

  @Get('tax-rates')
  @RequirePermissions('settings:read')
  @ApiOkResponse({ type: [TaxRateDto] })
  findTaxRates(@CurrentUser('companyId') companyId: string) {
    return this.settings.findTaxRates(companyId);
  }

  @Post('tax-rates')
  @RequirePermissions('settings:update')
  @ApiOkResponse({ type: TaxRateDto })
  createTaxRate(@CurrentUser('companyId') companyId: string, @Body() dto: CreateTaxRateDto) {
    return this.settings.createTaxRate(companyId, dto);
  }

  @Patch('tax-rates/:id')
  @RequirePermissions('settings:update')
  @ApiOkResponse({ type: TaxRateDto })
  updateTaxRate(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxRateDto,
  ) {
    return this.settings.updateTaxRate(companyId, id, dto);
  }

  @Get('units')
  @RequirePermissions('settings:read')
  @ApiOkResponse({ type: [UnitDto] })
  findUnits(@CurrentUser('companyId') companyId: string) {
    return this.settings.findUnits(companyId);
  }

  @Post('units')
  @RequirePermissions('settings:update')
  @ApiOkResponse({ type: UnitDto })
  createUnit(@CurrentUser('companyId') companyId: string, @Body() dto: CreateUnitDto) {
    return this.settings.createUnit(companyId, dto);
  }

  @Patch('units/:id')
  @RequirePermissions('settings:update')
  @ApiOkResponse({ type: UnitDto })
  updateUnit(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.settings.updateUnit(companyId, id, dto);
  }

  @Get('company')
  @RequirePermissions('settings:read')
  @ApiOkResponse({ type: [SettingDto] })
  findCompanySettings(@CurrentUser('companyId') companyId: string) {
    return this.settings.findCompanySettings(companyId);
  }

  @Put('company/:key')
  @RequirePermissions('settings:update')
  @ApiOkResponse({ type: SettingDto })
  upsertCompanySetting(
    @CurrentUser('companyId') companyId: string,
    @Param('key') key: string,
    @Body() dto: UpsertSettingDto,
  ) {
    return this.settings.upsertCompanySetting(companyId, key, dto.value);
  }
}
