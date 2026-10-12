import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { CashFlowService } from './cash-flow.service';
import {
  CashFlowDto,
  CashFlowQueryDto,
  TradeReportDto,
  TradeReportQueryDto,
} from './dto/reports.dto';
import { TradeReportsService } from './trade-reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(
    private readonly trade: TradeReportsService,
    private readonly cashFlow: CashFlowService,
  ) {}

  @Get('sales')
  @RequirePermissions('sales:read')
  @ApiOkResponse({ type: TradeReportDto })
  sales(@CurrentUser('companyId') companyId: string, @Query() query: TradeReportQueryDto) {
    return this.trade.report(companyId, 'sales', query);
  }

  @Get('purchases')
  @RequirePermissions('purchasing:read')
  @ApiOkResponse({ type: TradeReportDto })
  purchases(@CurrentUser('companyId') companyId: string, @Query() query: TradeReportQueryDto) {
    return this.trade.report(companyId, 'purchases', query);
  }

  @Get('cash-flow')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: CashFlowDto })
  cashFlowReport(@CurrentUser('companyId') companyId: string, @Query() query: CashFlowQueryDto) {
    return this.cashFlow.report(companyId, query);
  }
}
