import { Arc } from './arc';
import { EventItem } from './transition';

/**
 * Types of log related elements and lists
 */

// Type: Partial Order or sequential log
export interface PartialOrder {
  events: EventItem[];
  arcs: Arc[];

  initialEvents?: string[];
  finalEvents?: string[];
}

/**
 * Identify the start and end events of the log
 * @param partialOrder a object list of events
 */
export function determineInitialAndFinalEvents(
  partialOrder: PartialOrder
): void {
  const initialEvents: string[] = [];
  const finalEvents: string[] = [];

  for (const e of partialOrder.events) {
    if (e.previousEvents.length === 0) {
      initialEvents.push(e.id);
    }
    if (e.nextEvents.length === 0) {
      finalEvents.push(e.id);
    }
  }

  partialOrder.initialEvents = initialEvents;
  partialOrder.finalEvents = finalEvents;
}

export interface LogList {
  rowId: number,
  rowContent: string,
  caseId: number,
  name: string,
}

export interface ModelList {
  rowId: number,
  rowContent: string,
}

export interface CaseList {
  caseId: number,
  sequence: string,
}

export interface ArcList {
  arc: string,
}

export interface wrongContinuation {
  id: number;
  type: string;
  wrongContinuation: string;
  firstInvalidTransition: string;
}