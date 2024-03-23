import { Arc } from '../arc';
import { ConcreteElementWithArcs } from '../draggable';
import { PartialOrder } from '../partial-order';
import { PetriNet } from '../petri-net';
import { Place } from '../place';
import { EventItem, Transition } from '../transition';

export function addTransition(
  petriNet: PetriNet,
  element: Transition
): boolean {
  const contained = petriNet.transitions.some((item) => item.id == element.id);
  if (contained) {
    return false;
  }

  petriNet.transitions.push(element);
  return true;
}

export function generateEventItem(id: string, label?: string): EventItem {
  return {
    id,
    label: label ?? id,
    type: 'event',
    incomingArcs: [],
    outgoingArcs: [],
    nextEvents: [],
    previousEvents: [],
  };
}

export function addEventItem(
  partialOrder: PartialOrder | undefined,
  element: EventItem
): string {
  const contained = partialOrder?.events.some((item) => item.id == element.id);
  if (contained) {
    const countWithSameLabel = partialOrder?.events.filter(
      (item) => item.label == element.label
    );
    element.id += countWithSameLabel?.length ?? 1;
  }

  partialOrder?.events.push(element);
  return element.id;
}

export function addPlace(petriNet: PetriNet, place: Place): boolean {
  const contained = petriNet.places.some((item) => item.id == place.id);
  if (contained) {
    return false;
  }

  petriNet.places.push(place);
  return true;
}

export function addArc(
  run: PetriNet | PartialOrder | undefined,
  arc: Arc
): boolean {
  const contained = run?.arcs.some(
    (item) => item.source == arc.source && item.target == arc.target
  );
  if (contained) {
    return false;
  }

  run?.arcs.push(arc);
  return true;
}

/**
 * Set references from arcs to transitions and vice versa
 * @returns all references found?
 */
export function setRefs(net: PetriNet): boolean {
  let check = true;
  const concreteElements: ConcreteElementWithArcs[] = getElementsWithArcs(net);
  concreteElements.forEach((e) => {
    e.incomingArcs = [];
    e.outgoingArcs = [];
  });

  net.arcs.forEach((a) => {
    const source = concreteElements.find((e) => e.id == a.source);
    const target = concreteElements.find((e) => e.id == a.target);

    if (!source || !target) {
      check = false;
      net.arcs.slice(net.arcs.indexOf(a), 1);
    } else {
      source.outgoingArcs.push(a);
      target.incomingArcs.push(a);
    }
  });

  return check;
}

export function getEmptyNet(): PetriNet {
  return {
    transitions: [],
    places: [],
    arcs: [],
  };
}

export function getElementsWithArcs(net: PetriNet): (Transition | Place)[] {
  return [...net.transitions, ...net.places];
}
