import { Prisma, WorkOrderStatus } from '@prisma/client';

type Dec = Prisma.Decimal;
type Numeric = Dec | number | string;

const dec = (value: Numeric) => new Prisma.Decimal(value);
export const ZERO = dec(0);

export interface BomLineInput {
  variantId: string;
  quantity: Numeric;
  scrapRate: Numeric;
}

export interface BomShape {
  /** Output of one batch. */
  quantity: Numeric;
  laborCost: Numeric;
  overheadCost: Numeric;
  lines: BomLineInput[];
}

/** Planned use of a BOM line per unit of output: quantity × (1 + scrap %) / batch. */
export function perUnit(line: { quantity: Numeric; scrapRate: Numeric }, batch: Numeric): Dec {
  return dec(line.quantity)
    .times(dec(1).plus(dec(line.scrapRate).dividedBy(100)))
    .dividedBy(batch)
    .toDecimalPlaces(6);
}

/** Quantity needed for `output` units; rounded up so the plan never falls short. */
export function required(quantityPer: Numeric, output: Numeric): Dec {
  return dec(quantityPer).times(output).toDecimalPlaces(3, Prisma.Decimal.ROUND_UP);
}

/** Labour or overhead per unit of output. */
export const costPerUnit = (batchCost: Numeric, batch: Numeric): Dec =>
  dec(batchCost).dividedBy(batch).toDecimalPlaces(4);

/**
 * Standard consumption of one component for a production record. The record that finishes the
 * order uses up whatever is left of the requirement, so the totals match the plan exactly.
 */
export function standardConsumption(input: {
  quantityPer: Numeric;
  requiredQty: Numeric;
  consumedQty: Numeric;
  output: Numeric;
  finishes: boolean;
}): Dec {
  const remaining = Prisma.Decimal.max(dec(input.requiredQty).minus(input.consumedQty), ZERO);
  if (input.finishes) return remaining;
  return Prisma.Decimal.min(required(input.quantityPer, input.output), remaining);
}

/**
 * Standard unit cost of a BOM: components at their cost plus labour and overhead, divided by the
 * batch. `costOf` returns the unit cost of a component (average cost or its own rolled-up cost).
 */
export function rollUpCost(bom: BomShape, costOf: (variantId: string) => Dec) {
  const material = bom.lines.reduce(
    (sum, line) =>
      sum.plus(
        dec(line.quantity)
          .times(dec(1).plus(dec(line.scrapRate).dividedBy(100)))
          .times(costOf(line.variantId)),
      ),
    ZERO,
  );
  const batch = dec(bom.quantity);
  const labor = dec(bom.laborCost);
  const overhead = dec(bom.overheadCost);
  return {
    material: material.toDecimalPlaces(2),
    labor: labor.toDecimalPlaces(2),
    overhead: overhead.toDecimalPlaces(2),
    unitCost: material.plus(labor).plus(overhead).dividedBy(batch).toDecimalPlaces(4),
  };
}

/**
 * True when using `components` to make `output` would close a loop through the default BOMs,
 * e.g. A needs B and B (directly or deeper) needs A.
 */
export function createsCycle(
  output: string,
  components: string[],
  componentsOf: (variantId: string) => string[],
): boolean {
  const seen = new Set<string>();
  const stack = [...components];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === output) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...componentsOf(current));
  }
  return false;
}

export interface ExplodedLine {
  level: number;
  variantId: string;
  parentId: string;
  /** Needed for the parent's quantity. */
  quantity: Dec;
  /** Covered by stock (allocated in tree order, so shared components are not counted twice). */
  allocated: Dec;
  shortage: Dec;
  /** The component has a BOM and is made, not bought. */
  made: boolean;
}

/**
 * Multi-level net explosion of `quantity` units of a variant (depth first, in BOM line order).
 * Each line takes what it can from `stock`; only the shortage of a made component is exploded
 * further, since that part still has to be produced.
 */
export function explode(
  variantId: string,
  quantity: Numeric,
  bomOf: (variantId: string) => BomShape | undefined,
  stock: Map<string, Dec>,
  maxDepth = 10,
): ExplodedLine[] {
  const left = new Map(stock);
  const result: ExplodedLine[] = [];
  const walk = (parentId: string, output: Dec, level: number) => {
    const bom = bomOf(parentId);
    if (!bom || level > maxDepth) return;
    for (const line of bom.lines) {
      const need = required(perUnit(line, bom.quantity), output);
      const free = Prisma.Decimal.max(left.get(line.variantId) ?? ZERO, ZERO);
      const allocated = Prisma.Decimal.min(free, need);
      left.set(line.variantId, free.minus(allocated));
      const shortage = need.minus(allocated);
      const made = Boolean(bomOf(line.variantId));
      result.push({
        level,
        variantId: line.variantId,
        parentId,
        quantity: need,
        allocated,
        shortage,
        made,
      });
      if (made && shortage.gt(0)) walk(line.variantId, shortage, level + 1);
    }
  };
  walk(variantId, dec(quantity), 1);
  return result;
}

/**
 * Net requirement (MRP): gross demand (open sales orders and work order materials) minus stock
 * on hand and what is already on its way (open purchase orders, open work order output).
 */
export function netRequirement(input: { gross: Numeric; onHand: Numeric; incoming: Numeric }): Dec {
  const onHand = Prisma.Decimal.max(dec(input.onHand), ZERO);
  return Prisma.Decimal.max(dec(input.gross).minus(onHand).minus(input.incoming), ZERO);
}

/** How many units the components on hand allow, given the per-unit use of each. */
export function buildable(lines: { quantityPer: Numeric; available: Numeric }[]): Dec {
  let max: Dec | null = null;
  for (const line of lines) {
    const per = dec(line.quantityPer);
    if (per.lte(0)) continue;
    const units = Prisma.Decimal.max(dec(line.available), ZERO)
      .dividedBy(per)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
    max = max === null ? units : Prisma.Decimal.min(max, units);
  }
  return max ?? ZERO;
}

/** Work orders whose materials still count as demand. */
export const OPEN_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.DRAFT,
  WorkOrderStatus.RELEASED,
  WorkOrderStatus.IN_PROGRESS,
];

export const canEdit = (status: WorkOrderStatus) => status === WorkOrderStatus.DRAFT;
export const canRelease = (status: WorkOrderStatus) => status === WorkOrderStatus.DRAFT;
export const canRecord = (status: WorkOrderStatus) =>
  status === WorkOrderStatus.RELEASED || status === WorkOrderStatus.IN_PROGRESS;
/** Orders with posted output are completed (closed short), not cancelled. */
export const canCancel = (status: WorkOrderStatus, produced: Numeric) =>
  (status === WorkOrderStatus.DRAFT || status === WorkOrderStatus.RELEASED) &&
  dec(produced).isZero();
export const canComplete = (status: WorkOrderStatus) => status === WorkOrderStatus.IN_PROGRESS;

/** Open order past its planned end date. */
export const isLate = (status: WorkOrderStatus, plannedEnd: Date, today: Date) =>
  OPEN_STATUSES.includes(status) && plannedEnd.getTime() < today.getTime();

/** Produced share of the order, 0–100. */
export function progress(produced: Numeric, quantity: Numeric): number {
  const total = dec(quantity);
  if (total.lte(0)) return 0;
  return Math.min(100, dec(produced).dividedBy(total).times(100).toDecimalPlaces(0).toNumber());
}

/** Whether the source warehouse covers a component: enough, partly or nothing. */
export function availability(needed: Numeric, onHand: Numeric): 'OK' | 'PARTIAL' | 'MISSING' {
  const need = dec(needed);
  const have = dec(onHand);
  if (need.lte(0) || have.gte(need)) return 'OK';
  return have.gt(0) ? 'PARTIAL' : 'MISSING';
}
