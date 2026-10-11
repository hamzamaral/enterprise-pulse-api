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
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/pagination/pagination.dto';
import { DownloadUrlDto, FileDto, FileQueryDto, UploadFileDto } from './dto/file.dto';
import { FilesService, MAX_FILE_SIZE } from './files.service';

@ApiTags('Files')
@ApiBearerAuth()
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @RequirePermissions('files:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        entityType: { type: 'string' },
        entityId: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: FileDto })
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile(
      new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })] }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ) {
    return this.files.upload(user.companyId, user.id, file, dto);
  }

  @Get()
  @RequirePermissions('files:read')
  @ApiOkResponse({ type: PaginatedResponseDto(FileDto) })
  findAll(@CurrentUser('companyId') companyId: string, @Query() query: FileQueryDto) {
    return this.files.findAll(companyId, query);
  }

  /** Short-lived pre-signed URL; the browser downloads directly from object storage. */
  @Get(':id/download-url')
  @RequirePermissions('files:read')
  @ApiOkResponse({ type: DownloadUrlDto })
  downloadUrl(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.getDownloadUrl(companyId, id);
  }

  @Delete(':id')
  @RequirePermissions('files:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.remove(companyId, id);
  }
}
