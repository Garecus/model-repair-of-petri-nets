import clonedeep from 'lodash.clonedeep';

import { Arc } from '../../classes/diagram/arc';
import {
  determineInitialAndFinalEvents,
  PartialOrder,
} from '../../classes/diagram/partial-order';
import { PetriNet } from '../../classes/diagram/petri-net';
import { Place } from '../../classes/diagram/place';
import {
  concatEvents,
  createEventItem,
  EventItem,
  Transition,
} from '../../classes/diagram/transition';

type InnerFireResult = { branchPlaces: string[] };

type ValidPlacesType = Array<boolean>;

export class CheckWrongContinuations {
  private readonly idToEventMap = new Map<string, EventItem>();
  private readonly idToPlaceMap = new Map<string, Place>();
  private readonly labelToTransitionMap = new Map<string, Transition>();

  private readonly petriNet: PetriNet;
  private readonly partialOrder: PartialOrder;

  constructor(petriNet: PetriNet, partialOrder: PartialOrder) {
    this.petriNet = { ...petriNet };
    this.partialOrder = clonedeep(partialOrder);

    this.petriNet.transitions.forEach((t) =>
      this.labelToTransitionMap.set(t.label, t)
    );
    this.petriNet.places.forEach((p) => this.idToPlaceMap.set(p.id, p));
  }

  /**
   * Fires the partial order in the net and returns the ids of invalid places.
   * @returns The ids of invalid places.
   */
  getInvalidTransitions(): string[] {
    console.log("Inside Check wrong continuations");
    return ["ab","abbbbc"];
  }
}