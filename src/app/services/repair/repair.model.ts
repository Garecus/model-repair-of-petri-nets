import { wrongContinuation } from 'src/app/classes/diagram/partial-order';
import { SolutionType } from '../../algorithms/regions/ilp-solver/solver-classes';
import { AutoRepairWithSolutionType } from '../../algorithms/regions/parse-solutions.fn';

/**
   * Types of solutions
   */

export type ParsableSolution =
  | {
    type: 'increase-marking';
    newMarking: number;
  }
  | IncomingArcSolution
  | OutgoingArcSolution;

export type IncomingArcSolution = {
  type: 'incoming-arc';
  incoming: string;
  marking: number;
};

export type OutgoingArcSolution = {
  type: 'outgoing-arc';
  outgoing: string;
  marking: number;
};

export type ParsableSolutionsPerType = {
  type: SolutionType;
  regionSize: number;
  solutionParts: ParsableSolution[][];
};

export type PlaceSolution =
  | {
    type: 'error';
    place: string;
    solutions: AutoRepairWithSolutionType[];
    invalidTraceCount: number;
    missingTokens: number | undefined;
    regionSize: number;
  }
  | {
    type: 'warning';
    place: string;
    tooManyTokens: number;
    reduceTokensTo: number;
    regionSize: number;
  }
  | NewTransitionSolution
  | PrecisionSolution;

export type NewTransitionSolution = {
  type: 'newTransition';
  missingTransition: string;
  solutions: AutoRepairWithSolutionType[];
  invalidTraceCount: number;
  regionSize: number;
};

// [precision model repair]
export type PrecisionSolution =
  {
    type: 'possibility';
    place: string;
    solutions: AutoRepairWithSolutionType[];
    invalidTraceCount: number;
    missingTokens: number | undefined;
    regionSize: number;

    tooManyTokens?: number;
    reduceTokensTo?: number;
    missingTransition?: string;

    wrongContinuations?: wrongContinuation[];
    transition?: string;
    missingPlace?: string;
    newTransition?: string;
  }
  | {
    type: 'implicit';
    place: string;
    solutions: AutoRepairWithSolutionType[];
    invalidTraceCount: number;
    missingTokens: number | undefined;
    regionSize: number;

    tooManyTokens?: number;
    reduceTokensTo?: number;
    missingTransition?: string;

    wrongContinuations?: wrongContinuation[];
    transition?: string;
    missingPlace?: string;
    newTransition?: string;
  };
