import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import {
  EInvoiceDetailDto,
  EInvoiceDto,
  EInvoiceQueryDto,
  EInvoiceSettingsDto,
  EInvoiceSummaryDto,
  RespondEInvoiceDto,
  SendEInvoiceDto,
  SimulateIncomingDto,
  SyncResultDto,
  UnsentInvoiceDto,
  UpdateEInvoiceSettingsDto,
} from './dto/einvoice.dto';
import { EInvoiceService } from './einvoice.service';

@ApiTags('e-Invoice')
@ApiBearerAuth()
@Controller({ path: 'e-invoices', version: '1' })
export class EInvoiceController {
  constructor(private readonly einvoice: EInvoiceService) {}

  @Get()
  @RequirePermissions('einvoice:read')
  @ApiOkResponse({ type: PaginatedResponseDto(EInvoiceDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: EInvoiceQueryDto) {
    return this.einvoice.list(companyId, query);
  }

  @Get('summary')
  @RequirePermissions('einvoice:read')
  @ApiOkResponse({ type: EInvoiceSummaryDto })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.einvoice.summary(companyId);
  }

  /** Issued sales invoices that were not sent yet. */
  @Get('unsent')
  @RequirePermissions('einvoice:read')
  @ApiOkResponse({ type: [UnsentInvoiceDto] })
  unsent(@CurrentUser('companyId') companyId: string) {
    return this.einvoice.unsent(companyId);
  }

  @Get('settings')
  @RequirePermissions('einvoice:read')
  @ApiOkResponse({ type: EInvoiceSettingsDto })
  settings(@CurrentUser('companyId') companyId: string) {
    return this.einvoice.settings(companyId);
  }

  @Patch('settings')
  @RequirePermissions('einvoice:update')
  @ApiOkResponse({ type: EInvoiceSettingsDto })
  updateSettings(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdateEInvoiceSettingsDto,
  ) {
    return this.einvoice.updateSettings(companyId, dto);
  }

  /** Queues a sales invoice for GİB. */
  @Post()
  @RequirePermissions('einvoice:send')
  @ApiOkResponse({ type: EInvoiceDetailDto })
  send(@CurrentUser() user: AuthUser, @Body() dto: SendEInvoiceDto) {
    return this.einvoice.send(user, dto);
  }

  /** Runs the simulated integrator now (a background job does the same every minute). */
  @Post('sync')
  @RequirePermissions('einvoice:send')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SyncResultDto })
  sync(@CurrentUser('companyId') companyId: string) {
    return this.einvoice.sync(companyId);
  }

  /** Simulates an e-Fatura arriving from a supplier. */
  @Post('simulate-incoming')
  @RequirePermissions('einvoice:update')
  @ApiOkResponse({ type: EInvoiceDetailDto })
  simulateIncoming(@CurrentUser() user: AuthUser, @Body() dto: SimulateIncomingDto) {
    return this.einvoice.simulateIncoming(user, dto);
  }

  @Get(':id')
  @RequirePermissions('einvoice:read')
  @ApiOkResponse({ type: EInvoiceDetailDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.einvoice.findOne(companyId, id);
  }

  @Post(':id/resend')
  @RequirePermissions('einvoice:send')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: EInvoiceDetailDto })
  resend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.einvoice.resend(user, id);
  }

  /** Accept or reject an incoming ticari fatura. */
  @Post(':id/respond')
  @RequirePermissions('einvoice:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: EInvoiceDetailDto })
  respond(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondEInvoiceDto,
  ) {
    return this.einvoice.respond(user, id, dto);
  }

  /** Simulates the receiver accepting or rejecting an outgoing ticari fatura. */
  @Post(':id/simulate-response')
  @RequirePermissions('einvoice:send')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: EInvoiceDetailDto })
  simulateResponse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondEInvoiceDto,
  ) {
    return this.einvoice.simulateResponse(user, id, dto);
  }

  /** Records an incoming invoice as a purchase invoice. */
  @Post(':id/record')
  @RequirePermissions('einvoice:update', 'purchasing:create')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: EInvoiceDetailDto })
  record(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.einvoice.record(user, id);
  }
}
