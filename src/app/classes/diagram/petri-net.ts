import { Arc } from './arc';
import { Place } from './place';
import { Transition } from './transition';

/**
   * Contains all the petri net information that are used in the displayed process model
   */

export interface PetriNet {
  transitions: Transition[];
  places: Place[];
  arcs: Arc[];
}

/**
   * Contains all the petri net information that are used in the displayed process model
   * @param petriNet the petri net list
   * @return properties, if the petri net list is empty
   */
export function isNetEmpty(petriNet: PetriNet): boolean {
  return (
    petriNet.arcs.length === 0 &&
    petriNet.places.length === 0 &&
    petriNet.transitions.length === 0
  );
}
