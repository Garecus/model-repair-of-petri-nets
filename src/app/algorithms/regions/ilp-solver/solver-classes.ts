import { LP, Result } from 'glpk.js';

import { Constraint } from './solver-constants';

export type SubjectTo = {
  name: string;
  vars: Array<Variable>;
  bnds: Bound;
};

export type Variable = {
  name: string;
  coef: number;
};

export type Bound = {
  type: Constraint;
  ub: number;
  lb: number;
};

export enum VariableType {
  INITIAL_MARKING,
  OUTGOING_TRANSITION_WEIGHT,
  INCOMING_TRANSITION_WEIGHT,
}

export interface SolutionVariable {
  label: string;
  type: VariableType;
}

export type SolutionType =
  | 'changeIncoming' // Fitness
  | 'changeMarking' // Fitness
  | 'multiplePlaces' // Fitness
  | 'addPlace' // Precision
  | 'addTrace'; // Precision

export interface ProblemSolutionWithoutType {
  ilp: LP;
  solution: Result;
}

export type Vars = { [key: string]: number };

export interface ProblemSolution {
  type: SolutionType;
  solutions: Vars[];
  regionSize: number;
}

export enum VariableName {
  INITIAL_MARKING = 'm0',
  INGOING_ARC_WEIGHT_PREFIX = 'in',
  OUTGOING_ARC_WEIGHT_PREFIX = 'out',
}
