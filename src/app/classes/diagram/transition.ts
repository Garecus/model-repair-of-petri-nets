import { ConcreteElementWithArcs } from './draggable';

export interface Transition extends ConcreteElementWithArcs {
  type: 'transition';
  label: string;
  issueStatus?: 'warning' | 'error' | 'possibility';
  relatedWrongContinuationsCount?: string;
}

/**
   * Contains all the transition / event information that are used in the displayed process model
   */
export interface EventItem extends ConcreteElementWithArcs {
  type: 'event';
  label: string;

  nextEvents: string[];
  previousEvents: string[];

  // Required for firing the partial order
  localMarking?: number[];
}

/**
   * Function to create an event object
   * @param id of the event in the event log
   * @returns the event object
   */
export function createEventItem(id: string): EventItem {
  return {
    id,
    type: 'event',
    label: id,
    nextEvents: [],
    previousEvents: [],
    incomingArcs: [],
    outgoingArcs: [],
  };
}

/**
   * Concat the events if they have the same id and add the event to the next or previous events list
   * @param first event object
   * @param second event object
   */
export function concatEvents(first: EventItem, second: EventItem): void {
  if (!first.nextEvents.includes(second.id)) {
    first.nextEvents.push(second.id);
  }
  if (!second.previousEvents.includes(first.id)) {
    second.previousEvents.push(first.id);
  }
}
