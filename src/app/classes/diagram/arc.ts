import { ConcreteElement } from './draggable';

/**
   * Contains all the arc information that are used in the displayed process model
   */

export type Arc = {
  source: string;
  target: string;
  weight: number;
  breakpoints: Breakpoint[];
};

export interface Breakpoint extends ConcreteElement {
  type: 'breakpoint';
  x: number;
  y: number;
  arc: Arc;
}
