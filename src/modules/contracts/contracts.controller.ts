import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { DownloadUrlDto } from '../files/dto/file.dto';
import { MAX_FILE_SIZE } from '../files/files.service';
import {
  ActivateContractDto,
  ContractDetailDto,
  ContractDto,
  ContractOwnerDto,
  ContractQueryDto,
  ContractRunResultDto,
  ContractSummaryDto,
  ContractTypeDto,
  CreateContractDto,
  CreateContractTypeDto,
  RenewContractDto,
  TerminateContractDto,
  UpdateContractDto,
  UpdateContractTypeDto,
} from './dto/contract.dto';
import { ContractSummaryService } from './contract-summary.service';
import { ContractTypesService } from './contract-types.service';
import { ContractsService } from './contracts.service';

@ApiTags('Contracts')
@ApiBearerAuth()
@Controller({ path: 'contracts', version: '1' })
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly summaryService: ContractSummaryService,
  ) {}

  @Get()
  @RequirePermissions('contracts:read')
  @ApiOkResponse({ type: PaginatedResponseDto(ContractDto) })
  findAll(@CurrentUser() user: AuthUser, @Query() query: ContractQueryDto) {
    return this.contracts.findAll(user, query);
  }

  @Get('summary')
  @RequirePermissions('contracts:read')
  @ApiOkResponse({ type: ContractSummaryDto })
  summary(@CurrentUser('companyId') companyId: string) {
    return this.summaryService.summary(companyId);
  }

  /** Users who can own contracts. */
  @Get('owners')
  @RequireAnyPermission('contracts:create', 'contracts:update')
  @ApiOkResponse({ type: [ContractOwnerDto] })
  owners(@CurrentUser('companyId') companyId: string) {
    return this.contracts.owners(companyId);
  }

  /** Runs the daily renewal, expiry and reminder job for the current company now. */
  @Post('run')
  @RequirePermissions('contracts:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ContractRunResultDto })
  run(@CurrentUser('companyId') companyId: string) {
    return this.contracts.run(companyId);
  }

  /** `contracts:read` holders and the owner can open a contract. */
  @Get(':id')
  @ApiOkResponse({ type: ContractDetailDto })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.findOne(user, id);
  }

  @Post()
  @RequirePermissions('contracts:create')
  @ApiOkResponse({ type: ContractDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContractDto) {
    return this.contracts.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('contracts:update')
  @ApiOkResponse({ type: ContractDetailDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contracts.update(user, id, dto);
  }

  @Post(':id/activate')
  @RequirePermissions('contracts:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ContractDetailDto })
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActivateContractDto,
  ) {
    return this.contracts.activate(user, id, dto);
  }

  @Post(':id/renew')
  @RequirePermissions('contracts:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ContractDetailDto })
  renew(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewContractDto,
  ) {
    return this.contracts.renew(user, id, dto);
  }

  @Post(':id/terminate')
  @RequirePermissions('contracts:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ContractDetailDto })
  terminate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminateContractDto,
  ) {
    return this.contracts.terminate(user, id, dto);
  }

  @Post(':id/cancel-termination')
  @RequirePermissions('contracts:update')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ContractDetailDto })
  cancelTermination(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.cancelTermination(user, id);
  }

  @Delete(':id')
  @RequirePermissions('contracts:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.remove(user, id);
  }

  @Post(':id/attachments')
  @RequirePermissions('contracts:update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: ContractDetailDto })
  uploadAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })] }),
    )
    file: Express.Multer.File,
  ) {
    return this.contracts.uploadAttachment(user, id, file);
  }

  @Get(':id/attachments/:fileId/url')
  @ApiOkResponse({ type: DownloadUrlDto })
  attachmentUrl(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    return this.contracts.attachmentUrl(user, id, fileId);
  }

  @Delete(':id/attachments/:fileId')
  @RequirePermissions('contracts:update')
  @ApiOkResponse({ type: ContractDetailDto })
  removeAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    return this.contracts.removeAttachment(user, id, fileId);
  }
}

@ApiTags('Contracts')
@ApiBearerAuth()
@Controller({ path: 'contract-types', version: '1' })
export class ContractTypesController {
  constructor(private readonly types: ContractTypesService) {}

  @Get()
  @RequireAnyPermission('contracts:read', 'contracts:create', 'contracts:update')
  @ApiOkResponse({ type: [ContractTypeDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.types.findAll(companyId);
  }

  @Post()
  @RequirePermissions('contracts:update')
  @ApiOkResponse({ type: ContractTypeDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateContractTypeDto) {
    return this.types.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('contracts:update')
  @ApiOkResponse({ type: ContractTypeDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractTypeDto,
  ) {
    return this.types.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('contracts:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.types.remove(companyId, id);
  }
}
