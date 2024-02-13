import {
  parsedInvalidPartialOrder,
  parsedPartialOrder,
  parsedPetriNet,
} from '../../services/upload/example-file-parsed';
import { CheckWrongContinuations } from './check-wrong-continuations';

describe('fire partial orders', () => {
  it('should fire partial orders', () => {
    const result = new CheckWrongContinuations(
      parsedPetriNet,
      parsedPartialOrder
    ).getInvalidTransitions();

    expect(result).toEqual([]);
  });

  it('should fire partial orders for invalid', () => {
    const result = new CheckWrongContinuations(
      parsedPetriNet,
      parsedInvalidPartialOrder
    ).getInvalidTransitions();

    expect(result).toEqual(['p5', 'p7']);
  });
});
