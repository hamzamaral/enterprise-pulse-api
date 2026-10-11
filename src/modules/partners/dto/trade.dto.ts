import { ApiProperty } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** A priced document line: product or free text, quantity, price, discount and VAT. */
export class TradeLineInputDto {
  @IsOptional()
  @IsUUID()
  variantId?: string;

  /** Defaults to the product name; required for lines without a product. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountRate?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  vatRate?: number;
}

export class CurrencyInputDto {
  /** Defaults to the partner's currency. */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;

  /** Units of base currency per 1 unit; defaults to the latest stored selling rate. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  exchangeRate?: number;
}

export class TradeLineDto {
  id: string;
  lineNo: number;
  variantId: string | null;
  productId: string | null;
  sku: string | null;
  @ApiProperty({ enum: ProductType, enumName: 'ProductType', nullable: true })
  productType: ProductType | null;
  unitCode: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  vatRate: string;
  /** Including VAT. */
  lineTotal: string;
}

export class DocumentTotalsDto {
  subtotal: string;
  discountTotal: string;
  vatTotal: string;
  grandTotal: string;
  /** Grand total in the company's base currency. */
  grandTotalBase: string;
}
