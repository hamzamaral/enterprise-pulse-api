import { Prisma, WorkOrderStatus } from '@prisma/client';
import {
  availability,
  buildable,
  canCancel,
  canComplete,
  canEdit,
  canRecord,
  createsCycle,
  explode,
  isLate,
  netRequirement,
  perUnit,
  progress,
  required,
  rollUpCost,
  standardConsumption,
  type BomShape,
} from './production-math';

const d = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const s = (value: Prisma.Decimal) => value.toFixed();

describe('production math', () => {
  it('plans use per unit with scrap and rounds requirements up', () => {
    expect(s(perUnit({ quantity: 5, scrapRate: 4 }, 10))).toBe('0.52');
    expect(s(perUnit({ quantity: 1, scrapRate: 0 }, 3))).toBe('0.333333');
    expect(s(required('0.333333', 3))).toBe('1');
    expect(s(required('0.52', 20))).toBe('10.4');
  });

  it('consumes the standard share and the rest on the finishing record', () => {
    const component = { quantityPer: '0.52', requiredQty: '10.4', consumedQty: '5.2' };
    expect(s(standardConsumption({ ...component, output: 5, finishes: false }))).toBe('2.6');
    expect(s(standardConsumption({ ...component, output: 5, finishes: true }))).toBe('5.2');
    expect(
      s(standardConsumption({ ...component, consumedQty: '10', output: 5, finishes: false })),
    ).toBe('0.4');
  });

  it('rolls up material, labour and overhead into a unit cost', () => {
    const bom: BomShape = {
      quantity: 10,
      laborCost: 300,
      overheadCost: 100,
      lines: [
        { variantId: 'coffee', quantity: 5, scrapRate: 4 },
        { variantId: 'water', quantity: 20, scrapRate: 0 },
      ],
    };
    const costs: Record<string, number> = { coffee: 500, water: 70 };
    const cost = rollUpCost(bom, (id) => d(costs[id]));
    expect(cost.material.toFixed(2)).toBe('4000.00');
    expect(cost.unitCost.toFixed(4)).toBe('440.0000');
  });

  it('detects loops through other bills of materials', () => {
    const graph: Record<string, string[]> = { kit: ['station', 'shirt'], station: ['monitor'] };
    const of = (id: string) => graph[id] ?? [];
    expect(createsCycle('monitor', ['kit'], of)).toBe(true);
    expect(createsCycle('kit', ['station'], of)).toBe(false);
    expect(createsCycle('desk', ['station', 'monitor'], of)).toBe(false);
  });

  it('explodes only the missing part of made components and shares stock', () => {
    const boms: Record<string, BomShape> = {
      kit: {
        quantity: 1,
        laborCost: 0,
        overheadCost: 0,
        lines: [
          { variantId: 'station', quantity: 1, scrapRate: 0 },
          { variantId: 'monitor', quantity: 1, scrapRate: 0 },
        ],
      },
      station: {
        quantity: 1,
        laborCost: 0,
        overheadCost: 0,
        lines: [{ variantId: 'monitor', quantity: 1, scrapRate: 0 }],
      },
    };
    const stock = new Map([
      ['station', d(4)],
      ['monitor', d(10)],
    ]);
    const lines = explode('kit', 10, (id) => boms[id], stock);
    expect(
      lines.map((l) => [
        l.level,
        l.variantId,
        s(l.quantity),
        s(l.allocated),
        s(l.shortage),
        l.made,
      ]),
    ).toEqual([
      [1, 'station', '10', '4', '6', true],
      [2, 'monitor', '6', '6', '0', false],
      [1, 'monitor', '10', '4', '6', false],
    ]);
    expect(s(stock.get('monitor')!)).toBe('10');
  });

  it('nets demand against stock and incoming supply', () => {
    expect(s(netRequirement({ gross: 12, onHand: 5, incoming: 4 }))).toBe('3');
    expect(s(netRequirement({ gross: 12, onHand: -2, incoming: 4 }))).toBe('8');
    expect(s(netRequirement({ gross: 5, onHand: 10, incoming: 0 }))).toBe('0');
  });

  it('counts whole units the stock allows', () => {
    expect(
      s(
        buildable([
          { quantityPer: 1, available: 15 },
          { quantityPer: '0.52', available: 6 },
        ]),
      ),
    ).toBe('11');
    expect(s(buildable([{ quantityPer: 2, available: -1 }]))).toBe('0');
    expect(s(buildable([]))).toBe('0');
  });

  it('allows actions by status', () => {
    expect(canEdit(WorkOrderStatus.DRAFT)).toBe(true);
    expect(canEdit(WorkOrderStatus.RELEASED)).toBe(false);
    expect(canRecord(WorkOrderStatus.DRAFT)).toBe(false);
    expect(canRecord(WorkOrderStatus.IN_PROGRESS)).toBe(true);
    expect(canCancel(WorkOrderStatus.RELEASED, 0)).toBe(true);
    expect(canCancel(WorkOrderStatus.RELEASED, 1)).toBe(false);
    expect(canComplete(WorkOrderStatus.RELEASED)).toBe(false);
  });

  it('reports lateness, progress and availability', () => {
    const today = new Date('2026-10-14T00:00:00Z');
    const yesterday = new Date('2026-10-13T00:00:00Z');
    expect(isLate(WorkOrderStatus.RELEASED, yesterday, today)).toBe(true);
    expect(isLate(WorkOrderStatus.COMPLETED, yesterday, today)).toBe(false);
    expect(isLate(WorkOrderStatus.DRAFT, today, today)).toBe(false);
    expect(progress(2, 6)).toBe(33);
    expect(progress(7, 6)).toBe(100);
    expect(availability(5, 5)).toBe('OK');
    expect(availability(5, 2)).toBe('PARTIAL');
    expect(availability(5, 0)).toBe('MISSING');
    expect(availability(0, 0)).toBe('OK');
  });
});
