import {
  Body,
  Controller,
  Delete,
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
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import {
  CreatePartnerDto,
  PartnerDto,
  PartnerQueryDto,
  PartnerStatementDto,
  StatementQueryDto,
  UpdatePartnerDto,
} from './dto/partner.dto';
import { PartnerLedgerService } from './partner-ledger.service';
import { PartnersService } from './partners.service';

/** Partner pickers are needed on purchasing, sales and finance documents too. */
const PARTNER_READERS = ['partners:read', 'purchasing:read', 'sales:read', 'finance:read'];

@ApiTags('Partners')
@ApiBearerAuth()
@Controller({ path: 'partners', version: '1' })
export class PartnersController {
  constructor(
    private readonly partners: PartnersService,
    private readonly ledger: PartnerLedgerService,
  ) {}

  @Get()
  @RequireAnyPermission(...PARTNER_READERS)
  @ApiOkResponse({ type: PaginatedResponseDto(PartnerDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: PartnerQueryDto) {
    return this.partners.findAll(companyId, query);
  }

  @Get(':id')
  @RequireAnyPermission(...PARTNER_READERS)
  @ApiOkResponse({ type: PartnerDto })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.partners.findOne(companyId, id);
  }

  @Get(':id/statement')
  @RequireAnyPermission('partners:read', 'finance:read')
  @ApiOkResponse({ type: PartnerStatementDto })
  statement(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.ledger.statement(companyId, id, query);
  }

  @Post()
  @RequirePermissions('partners:create')
  @ApiOkResponse({ type: PartnerDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreatePartnerDto) {
    return this.partners.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('partners:update')
  @ApiOkResponse({ type: PartnerDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartnerDto,
  ) {
    return this.partners.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('partners:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.partners.remove(companyId, id);
  }
}
