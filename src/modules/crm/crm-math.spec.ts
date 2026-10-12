import { OpportunityStage } from '@prisma/client';
import {
  defaultProbability,
  isOpenStage,
  stageAfterQuote,
  weightedAmount,
  winRate,
} from './crm-math';

describe('crm-math', () => {
  it('assigns increasing default probabilities along the pipeline', () => {
    expect(defaultProbability(OpportunityStage.PROSPECTING)).toBe(10);
    expect(defaultProbability(OpportunityStage.NEGOTIATION)).toBe(75);
    expect(defaultProbability(OpportunityStage.WON)).toBe(100);
    expect(defaultProbability(OpportunityStage.LOST)).toBe(0);
  });

  it('treats only WON and LOST as closed', () => {
    expect(isOpenStage(OpportunityStage.PROPOSAL)).toBe(true);
    expect(isOpenStage(OpportunityStage.WON)).toBe(false);
    expect(isOpenStage(OpportunityStage.LOST)).toBe(false);
  });

  it('weights the amount by probability with 2-decimal rounding', () => {
    expect(weightedAmount('1000', 25).toFixed(2)).toBe('250.00');
    expect(weightedAmount('333.33', 50).toFixed(2)).toBe('166.67');
  });

  it('moves early stages to PROPOSAL when a quote is sent', () => {
    expect(stageAfterQuote(OpportunityStage.PROSPECTING)).toBe(OpportunityStage.PROPOSAL);
    expect(stageAfterQuote(OpportunityStage.QUALIFICATION)).toBe(OpportunityStage.PROPOSAL);
    expect(stageAfterQuote(OpportunityStage.PROPOSAL)).toBe(OpportunityStage.PROPOSAL);
    expect(stageAfterQuote(OpportunityStage.NEGOTIATION)).toBe(OpportunityStage.NEGOTIATION);
  });

  it('computes the win rate over closed opportunities', () => {
    expect(winRate(3, 1)).toBe(75);
    expect(winRate(0, 0)).toBeNull();
    expect(winRate(1, 2)).toBe(33);
  });
});
