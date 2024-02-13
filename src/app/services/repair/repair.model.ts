import { SolutionType } from '../../algorithms/regions/ilp-solver/solver-classes';
import { AutoRepairWithSolutionType } from '../../algorithms/regions/parse-solutions.fn';

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
  | NewTransitionSolution;

export type NewTransitionSolution = {
  type: 'newTransition';
  missingTransition: string;
  solutions: AutoRepairWithSolutionType[];
  invalidTraceCount: number;
  regionSize: number;
};

// Precision.TransitionSolution
export type TransitionSolution =
  {
    type: 'newPlace';
    solutions: AutoRepairWithSolutionType[];
    wrongContinuations: string;
    transition: string;
    missingPlace: string;

    place: string;
    invalidTraceCount: number;
    missingTokens: number | undefined;
    regionSize: number;
    tooManyTokens: number;
    reduceTokensTo: number;
    missingTransition: string;
  };
