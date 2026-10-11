import { Module } from '@nestjs/common';
import { PartnerLedgerService } from './partner-ledger.service';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

/** Customers and suppliers (cari hesaplar) and their ledger, shared by purchasing, sales and finance. */
@Module({
  controllers: [PartnersController],
  providers: [PartnersService, PartnerLedgerService],
  exports: [PartnersService, PartnerLedgerService],
})
export class PartnersModule {}
