import { Module } from '@nestjs/common';
import { PartnerLedgerService } from './partner-ledger.service';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import { TradeService } from './trade.service';

/** Customers and suppliers (cari hesaplar) and their ledger, shared by purchasing, sales and finance. */
@Module({
  controllers: [PartnersController],
  providers: [PartnersService, PartnerLedgerService, TradeService],
  exports: [PartnersService, PartnerLedgerService, TradeService],
})
export class PartnersModule {}
