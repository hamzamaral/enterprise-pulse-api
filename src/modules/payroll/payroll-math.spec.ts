import {
  computePayslip,
  DEFAULT_RATES,
  employedDays,
  incomeTaxOn,
  periodTotals,
  type PayslipInput,
} from './payroll-math';

const input = (overrides: Partial<PayslipInput> = {}): PayslipInput => ({
  month: 1,
  monthlySalary: '60000',
  employedDays: 30,
  missingDays: 0,
  overtimeHours: 0,
  extraEarnings: 0,
  otherDeductions: 0,
  cumulativeTaxBase: 0,
  ...overrides,
});
const slip = (overrides: Partial<PayslipInput> = {}) =>
  computePayslip(DEFAULT_RATES, input(overrides));

describe('incomeTaxOn', () => {
  it('applies the brackets progressively', () => {
    expect(incomeTaxOn(100_000, DEFAULT_RATES.taxBrackets).toFixed(2)).toBe('15000.00');
    // 190k × 15% + 10k × 20%
    expect(incomeTaxOn(200_000, DEFAULT_RATES.taxBrackets).toFixed(2)).toBe('30500.00');
    // 28.5k + 42k + 1.1M × 27% + 500k × 35%
    expect(incomeTaxOn(2_000_000, DEFAULT_RATES.taxBrackets).toFixed(2)).toBe('542500.00');
    expect(incomeTaxOn(0, DEFAULT_RATES.taxBrackets).toFixed(2)).toBe('0.00');
  });
});

describe('computePayslip', () => {
  it('leaves the minimum wage free of income and stamp tax', () => {
    const result = slip({ monthlySalary: '33030' });
    expect(result.sgkEmployee.toFixed(2)).toBe('4624.20');
    expect(result.unemploymentEmployee.toFixed(2)).toBe('330.30');
    expect(result.incomeTax.toFixed(2)).toBe(result.incomeTaxExemption.toFixed(2));
    expect(result.stampTax.toFixed(2)).toBe(result.stampTaxExemption.toFixed(2));
    expect(result.netPay.toFixed(2)).toBe('28075.50');
  });

  it('taxes only the part above the minimum wage', () => {
    const result = slip();
    expect(result.incomeTaxBase.toFixed(2)).toBe('51000.00');
    expect(result.incomeTax.toFixed(2)).toBe('7650.00');
    expect(result.incomeTaxExemption.toFixed(2)).toBe('4211.33');
    expect(result.stampTax.toFixed(2)).toBe('455.40');
    expect(result.stampTaxExemption.toFixed(2)).toBe('250.70');
    expect(result.netPay.toFixed(2)).toBe('47356.63');
    expect(result.sgkEmployer.toFixed(2)).toBe('9450.00');
    expect(result.unemploymentEmployer.toFixed(2)).toBe('1200.00');
    expect(result.employerCost.toFixed(2)).toBe('70650.00');
    expect(result.cumulativeTaxBase.toFixed(2)).toBe('51000.00');
  });

  it('carries the bracket over from earlier months', () => {
    // 10k left in the 15% bracket, the remaining 41k at 20%
    const result = slip({ month: 4, cumulativeTaxBase: '180000' });
    expect(result.incomeTax.toFixed(2)).toBe('9700.00');
    expect(result.cumulativeTaxBase.toFixed(2)).toBe('231000.00');
  });

  it('caps the SGK base at the ceiling', () => {
    const result = slip({ monthlySalary: '400000' });
    expect(result.sgkBase.toFixed(2)).toBe('297270.00');
    expect(result.sgkEmployee.toFixed(2)).toBe('41617.80');
  });

  it('raises the SGK base to the minimum wage', () => {
    const result = slip({ monthlySalary: '20000' });
    expect(result.sgkBase.toFixed(2)).toBe('33030.00');
  });

  it('pays missing days pro rata and overtime at 1.5 times the hourly wage', () => {
    const result = slip({ monthlySalary: '45000', missingDays: 2, overtimeHours: '10' });
    expect(result.payDays).toBe(28);
    expect(result.basePay.toFixed(2)).toBe('42000.00');
    // 45000 / 225 × 1.5 × 10
    expect(result.overtimePay.toFixed(2)).toBe('3000.00');
    expect(result.grossPay.toFixed(2)).toBe('45000.00');
  });

  it('adds earnings to the gross pay and takes deductions from the net pay', () => {
    const base = slip();
    const withItems = slip({ extraEarnings: '5000', otherDeductions: '2000' });
    expect(withItems.grossPay.toFixed(2)).toBe('65000.00');
    expect(withItems.otherDeductions.toFixed(2)).toBe('2000.00');
    expect(withItems.netPay.lt(base.netPay.plus(5000).minus(2000))).toBe(true);
  });

  it('pays nothing without paid days', () => {
    const result = slip({ employedDays: 3, missingDays: 3 });
    expect(result.grossPay.toFixed(2)).toBe('0.00');
    expect(result.sgkBase.toFixed(2)).toBe('0.00');
    expect(result.netPay.toFixed(2)).toBe('0.00');
  });

  it('sums a period', () => {
    const totals = periodTotals([slip(), slip({ monthlySalary: '33030' })]);
    expect(totals.employeeCount).toBe(2);
    expect(totals.grossTotal.toFixed(2)).toBe('93030.00');
    expect(totals.netTotal.toFixed(2)).toBe('75432.13');
    // employee 9000 + 4954.50, employer 10650 + 5862.83
    expect(totals.sgkTotal.toFixed(2)).toBe('30467.33');
    expect(totals.taxTotal.toFixed(2)).toBe('3643.37');
  });
});

describe('employedDays', () => {
  const day = (value: string) => new Date(`${value}T00:00:00Z`);

  it('counts a full month as 30 days', () => {
    expect(employedDays(day('2020-01-01'), null, 2026, 2)).toBe(30);
    expect(employedDays(day('2020-01-01'), null, 2026, 7)).toBe(30);
  });

  it('counts calendar days for hires and leavers', () => {
    expect(employedDays(day('2026-09-16'), null, 2026, 9)).toBe(15);
    expect(employedDays(day('2020-01-01'), day('2026-03-10'), 2026, 3)).toBe(10);
    expect(employedDays(day('2026-07-02'), null, 2026, 7)).toBe(30);
  });

  it('is zero outside the employment', () => {
    expect(employedDays(day('2026-10-01'), null, 2026, 9)).toBe(0);
    expect(employedDays(day('2020-01-01'), day('2026-05-31'), 2026, 6)).toBe(0);
  });
});
