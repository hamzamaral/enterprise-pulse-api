import { Prisma } from '@prisma/client';

type Value = Prisma.Decimal.Value;
const dec = (value: Value) => new Prisma.Decimal(value);
const round = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const ZERO = dec(0);

/** Salaries are monthly figures on a 30-day basis (SGK prim günü). */
export const MONTH_DAYS = 30;

export interface TaxBracket {
  /** Upper limit of the cumulative yearly base; null for the top bracket. */
  upTo: string | null;
  /** Fraction, e.g. "0.15". */
  rate: string;
}

export interface PayrollRates {
  minimumWage: Value;
  sgkCeiling: Value;
  sgkEmployeeRate: Value;
  unemploymentEmployeeRate: Value;
  sgkEmployerRate: Value;
  unemploymentEmployerRate: Value;
  stampTaxRate: Value;
  overtimeRate: Value;
  monthlyHours: number;
  taxBrackets: TaxBracket[];
}

export interface PayslipInput {
  /** 1–12; the minimum wage exemption is cumulative over the months of the year. */
  month: number;
  monthlySalary: Value;
  employedDays: number;
  missingDays: number;
  overtimeHours: Value;
  /** Taxable additions (prim, ikramiye). */
  extraEarnings: Value;
  /** Taken from the net pay (avans, icra). */
  otherDeductions: Value;
  /** Income tax base of the earlier months of the year. */
  cumulativeTaxBase: Value;
}

export interface PayslipResult {
  payDays: number;
  basePay: Prisma.Decimal;
  overtimePay: Prisma.Decimal;
  extraEarnings: Prisma.Decimal;
  grossPay: Prisma.Decimal;
  sgkBase: Prisma.Decimal;
  sgkEmployee: Prisma.Decimal;
  unemploymentEmployee: Prisma.Decimal;
  incomeTaxBase: Prisma.Decimal;
  cumulativeTaxBase: Prisma.Decimal;
  incomeTax: Prisma.Decimal;
  incomeTaxExemption: Prisma.Decimal;
  stampTax: Prisma.Decimal;
  stampTaxExemption: Prisma.Decimal;
  otherDeductions: Prisma.Decimal;
  netPay: Prisma.Decimal;
  sgkEmployer: Prisma.Decimal;
  unemploymentEmployer: Prisma.Decimal;
  employerCost: Prisma.Decimal;
}

/** Progressive income tax on a cumulative yearly base. */
export function incomeTaxOn(base: Value, brackets: TaxBracket[]): Prisma.Decimal {
  let remaining = dec(base);
  let lower = ZERO;
  let tax = ZERO;
  for (const bracket of brackets) {
    if (remaining.lte(0)) break;
    const width = bracket.upTo === null ? remaining : dec(bracket.upTo).minus(lower);
    const taxed = Prisma.Decimal.min(remaining, width);
    tax = tax.plus(taxed.mul(bracket.rate));
    remaining = remaining.minus(taxed);
    if (bracket.upTo !== null) lower = dec(bracket.upTo);
  }
  return tax;
}

/** Tax of `base` on top of `before`, i.e. the bracket position carries over between months. */
function marginalTax(before: Prisma.Decimal, base: Prisma.Decimal, brackets: TaxBracket[]) {
  return round(incomeTaxOn(before.plus(base), brackets).minus(incomeTaxOn(before, brackets)));
}

/** Days employed in a month, capped at 30; a full month is always 30. */
export function employedDays(
  hireDate: Date,
  terminationDate: Date | null,
  year: number,
  month: number,
): number {
  const first = Date.UTC(year, month - 1, 1);
  const last = Date.UTC(year, month, 0);
  const from = Math.max(first, hireDate.getTime());
  const to = Math.min(last, terminationDate?.getTime() ?? last);
  if (to < from) return 0;
  if (from === first && to === last) return MONTH_DAYS;
  return Math.min(MONTH_DAYS, Math.round((to - from) / 86_400_000) + 1);
}

/**
 * Turkish payroll for one employee and month: SGK and unemployment contributions on a base
 * between the minimum wage and the ceiling, cumulative progressive income tax, stamp tax and
 * the minimum wage exemptions of both taxes, all pro rata to the paid days.
 */
export function computePayslip(rates: PayrollRates, input: PayslipInput): PayslipResult {
  const payDays = Math.max(0, Math.min(MONTH_DAYS, input.employedDays) - input.missingDays);
  const share = dec(payDays).div(MONTH_DAYS);
  const salary = dec(input.monthlySalary);

  const basePay = round(salary.mul(share));
  const hourly = salary.div(rates.monthlyHours);
  const overtimePay = round(hourly.mul(rates.overtimeRate).mul(input.overtimeHours));
  const extraEarnings = round(dec(input.extraEarnings));
  const grossPay = basePay.plus(overtimePay).plus(extraEarnings);

  const floor = round(dec(rates.minimumWage).mul(share));
  const ceiling = round(dec(rates.sgkCeiling).mul(share));
  const sgkBase =
    payDays === 0 ? ZERO : Prisma.Decimal.min(ceiling, Prisma.Decimal.max(floor, grossPay));
  const sgkEmployee = round(sgkBase.mul(rates.sgkEmployeeRate));
  const unemploymentEmployee = round(sgkBase.mul(rates.unemploymentEmployeeRate));

  const incomeTaxBase = Prisma.Decimal.max(
    ZERO,
    grossPay.minus(sgkEmployee).minus(unemploymentEmployee),
  );
  const before = dec(input.cumulativeTaxBase);
  const incomeTax = marginalTax(before, incomeTaxBase, rates.taxBrackets);

  const employeeRate = dec(rates.sgkEmployeeRate).plus(rates.unemploymentEmployeeRate);
  const minimumBase = round(dec(rates.minimumWage).mul(dec(1).minus(employeeRate)));
  const exemptionTax = marginalTax(
    minimumBase.mul(input.month - 1),
    round(minimumBase.mul(share)),
    rates.taxBrackets,
  );
  const incomeTaxExemption = Prisma.Decimal.min(incomeTax, exemptionTax);

  const stampTax = round(grossPay.mul(rates.stampTaxRate));
  const stampTaxExemption = Prisma.Decimal.min(stampTax, round(floor.mul(rates.stampTaxRate)));

  const otherDeductions = round(dec(input.otherDeductions));
  const netPay = grossPay
    .minus(sgkEmployee)
    .minus(unemploymentEmployee)
    .minus(incomeTax.minus(incomeTaxExemption))
    .minus(stampTax.minus(stampTaxExemption))
    .minus(otherDeductions);

  const sgkEmployer = round(sgkBase.mul(rates.sgkEmployerRate));
  const unemploymentEmployer = round(sgkBase.mul(rates.unemploymentEmployerRate));

  return {
    payDays,
    basePay,
    overtimePay,
    extraEarnings,
    grossPay,
    sgkBase,
    sgkEmployee,
    unemploymentEmployee,
    incomeTaxBase,
    cumulativeTaxBase: before.plus(incomeTaxBase),
    incomeTax,
    incomeTaxExemption,
    stampTax,
    stampTaxExemption,
    otherDeductions,
    netPay,
    sgkEmployer,
    unemploymentEmployer,
    employerCost: grossPay.plus(sgkEmployer).plus(unemploymentEmployer),
  };
}

/** Totals of a period: contributions of both sides and taxes after the exemptions. */
export function periodTotals(slips: PayslipResult[]) {
  const sum = (pick: (slip: PayslipResult) => Prisma.Decimal) =>
    slips.reduce((total, slip) => total.plus(pick(slip)), ZERO);
  return {
    employeeCount: slips.length,
    grossTotal: sum((s) => s.grossPay),
    netTotal: sum((s) => s.netPay),
    sgkTotal: sum((s) =>
      s.sgkEmployee.plus(s.unemploymentEmployee).plus(s.sgkEmployer).plus(s.unemploymentEmployer),
    ),
    taxTotal: sum((s) =>
      s.incomeTax.minus(s.incomeTaxExemption).plus(s.stampTax).minus(s.stampTaxExemption),
    ),
    deductionTotal: sum((s) => s.otherDeductions),
    employerCostTotal: sum((s) => s.employerCost),
  };
}

/** Figures used when a company has no parameters for a year yet (2026, Turkey). */
export const DEFAULT_RATES: PayrollRates = {
  minimumWage: '33030.00',
  sgkCeiling: '297270.00',
  sgkEmployeeRate: '0.14',
  unemploymentEmployeeRate: '0.01',
  sgkEmployerRate: '0.1575',
  unemploymentEmployerRate: '0.02',
  stampTaxRate: '0.00759',
  overtimeRate: '1.5',
  monthlyHours: 225,
  taxBrackets: [
    { upTo: '190000.00', rate: '0.15' },
    { upTo: '400000.00', rate: '0.20' },
    { upTo: '1500000.00', rate: '0.27' },
    { upTo: '5300000.00', rate: '0.35' },
    { upTo: null, rate: '0.40' },
  ],
};
