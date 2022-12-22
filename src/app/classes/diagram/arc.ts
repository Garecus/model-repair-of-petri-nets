import { ConcreteElement } from './draggable';

export type Arc = {
  source: string;
  target: string;
  weight: number;
  breakpoints: Breakpoint[];
  currentRun?: boolean;
};

export interface Breakpoint extends ConcreteElement {
  type: 'breakpoint';
  x: number;
  y: number;
}
