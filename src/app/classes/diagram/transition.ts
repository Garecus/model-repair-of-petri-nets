import { ConcreteElementWithArcs } from './draggable';

export interface Transition extends ConcreteElementWithArcs {
  type: 'transition';
  label: string;
  issueStatus?: 'warning' | 'error' | 'possibility';
}

export interface EventItem extends ConcreteElementWithArcs {
  type: 'event';
  label: string;

  nextEvents: string[];
  previousEvents: string[];

  // Required for firing the partial order
  localMarking?: number[];
}

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

export function concatEvents(first: EventItem, second: EventItem): void {
  if (!first.nextEvents.includes(second.id)) {
    first.nextEvents.push(second.id);
  }
  if (!second.previousEvents.includes(first.id)) {
    second.previousEvents.push(first.id);
  }
}
