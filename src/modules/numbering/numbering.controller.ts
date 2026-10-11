import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import {
  CreateNumberSequenceDto,
  NumberSequenceDto,
  UpdateNumberSequenceDto,
} from './dto/number-sequence.dto';
import { NumberingService } from './numbering.service';

@ApiTags('Numbering')
@ApiBearerAuth()
@Controller({ path: 'number-sequences', version: '1' })
export class NumberingController {
  constructor(private readonly numbering: NumberingService) {}

  @Get()
  @RequirePermissions('numbering:read')
  @ApiOkResponse({ type: [NumberSequenceDto] })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.numbering.findAll(companyId);
  }

  @Post()
  @RequirePermissions('numbering:update')
  @ApiOkResponse({ type: NumberSequenceDto })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateNumberSequenceDto) {
    return this.numbering.create(companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('numbering:update')
  @ApiOkResponse({ type: NumberSequenceDto })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNumberSequenceDto,
  ) {
    return this.numbering.update(companyId, id, dto);
  }
}
