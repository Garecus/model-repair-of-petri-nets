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
import { MaxFlowPreflowN3 } from './max-flow-preflow-n3';

type InnerFireResult = { branchPlaces: string[] };

type ValidPlacesType = Array<boolean>;

export class FirePartialOrder {
  private readonly idToEventMap = new Map<string, EventItem>();
  private readonly idToPlaceMap = new Map<string, Place>();
  private readonly labelToTransitionMap = new Map<string, Transition>();

  private readonly petriNet: PetriNet;
  private readonly partialOrder: PartialOrder;
  private readonly partialOrders: PartialOrder[];

  constructor(petriNet: PetriNet, partialOrder: PartialOrder, partialOrders: PartialOrder[]) {
    this.petriNet = { ...petriNet };
    this.partialOrder = clonedeep(partialOrder);
    this.partialOrders = clonedeep(partialOrders);

    this.petriNet.transitions.forEach((t) =>
      this.labelToTransitionMap.set(t.label, t)
    );
    this.petriNet.places.forEach((p) => this.idToPlaceMap.set(p.id, p));
  }

  /**
   * Fires the partial order in the net and returns the ids of invalid places.
   * @returns The ids of invalid places.
   */
  getInvalidPlaces(): string[] {
    this.buildExtensionForPartialOrder();

    const totalOrder = this.buildTotalOrder(this.partialOrder);

    // Adds the initial marking to the first event.
    const initialEvent = totalOrder[0];
    for (let i = 0; i < this.petriNet.places.length; i++) {
      initialEvent.localMarking![i] = this.petriNet.places[i].marking;
    }

    const validPlaces: ValidPlacesType = new Array(
      this.petriNet.places.length
    ).fill(true);
    const notValidPlaces = new Array(this.petriNet.places.length).fill(false);

    const { branchPlaces } = this.fireForwards([...totalOrder], validPlaces);

    // not valid places
    const finalEvent = this.idToEventMap.get(
      [...this.partialOrder.finalEvents!][0]
    );
    if (!finalEvent) {
      throw new Error('Final event not found');
    }

    for (let i = 0; i < this.petriNet.places.length; i++) {
      notValidPlaces[i] = finalEvent.localMarking![i] < 0;
    }

    // Don't fire all backwards!
    const backwardsFireQueue = [finalEvent];
    for (let i = totalOrder.length - 2; i >= 0; i--) {
      totalOrder[i].localMarking = new Array<number>(
        this.petriNet.places.length
      ).fill(0);
      backwardsFireQueue.push(totalOrder[i]);
    }

    const backwardsValidPlaces: ValidPlacesType = new Array(
      this.petriNet.places.length
    ).fill(true);

    // Is the final marking > 0 ?
    for (let i = 0; i < this.petriNet.places.length; i++) {
      if (finalEvent.localMarking![i] < 0) {
        backwardsValidPlaces[i] = false;
      }
    }

    this.fireBackwards(backwardsFireQueue, backwardsValidPlaces);

    // Rest with flow
    const flow = new Array(this.petriNet.places.length).fill(false);
    for (let i = 0; i < this.petriNet.places.length; i++) {
      if (
        !validPlaces[i] &&
        branchPlaces.includes(this.petriNet.places[i].id) &&
        !notValidPlaces[i] &&
        !backwardsValidPlaces[i]
      ) {
        flow[i] = this.checkFlowForPlace(
          this.petriNet.places[i],
          this.partialOrder.events
        );
      }
    }

    return this.petriNet.places
      .filter((p, i) => {
        if (validPlaces[i]) {
          return false;
        } else if (backwardsValidPlaces[i]) {
          return false;
        } else return !flow[i];
      })
      .map((p) => p.id);
  }

  /**
   * Builds the extension for a partial order with an initial and final event.
   * @private
   */
  private buildExtensionForPartialOrder(): void {
    const initial: EventItem = createEventItem('initial_marking');
    const finalEvent: EventItem = createEventItem('final_marking');

    this.partialOrder.events = [
      initial,
      ...this.partialOrder.events,
      finalEvent,
    ];
    this.partialOrder.events.forEach((e) => this.idToEventMap.set(e.id, e));

    this.partialOrder.initialEvents?.forEach((eventId) => {
      const foundEventItem = this.idToEventMap.get(eventId);
      if (foundEventItem) {
        concatEvents(initial, foundEventItem);
      } else {
        console.error(`Event with id ${eventId} not found`);
      }
    });

    this.partialOrder.finalEvents?.forEach((eventId) => {
      const foundEventItem = this.idToEventMap.get(eventId);
      if (foundEventItem) {
        concatEvents(foundEventItem, finalEvent);
      } else {
        console.error(`Event with id ${eventId} not found`);
      }
    });
    determineInitialAndFinalEvents(this.partialOrder);
  }

  private fireForwards(
    queue: Array<EventItem>,
    validPlaces: ValidPlacesType
  ): InnerFireResult {
    return this.fire(
      queue,
      validPlaces,
      (t) => t.incomingArcs,
      (a) => this.idToPlaceMap.get(a.source),
      (t) => t.outgoingArcs,
      (a) => this.idToPlaceMap.get(a.target),
      (e) => e.nextEvents
    );
  }

  private fireBackwards(queue: Array<EventItem>, validPlaces: ValidPlacesType) {
    this.fire(
      queue,
      validPlaces,
      (t) => t.outgoingArcs,
      (a) => this.idToPlaceMap.get(a.target),
      (t) => t.incomingArcs,
      (a) => this.idToPlaceMap.get(a.source),
      (e) => e.previousEvents
    );
  }

  private fire(
    eventQueue: Array<EventItem>,
    validPlaces: ValidPlacesType,
    preArcs: (t: Transition) => Array<Arc>,
    prePlace: (a: Arc) => Place | undefined,
    postArcs: (t: Transition) => Array<Arc>,
    postPlace: (a: Arc) => Place | undefined,
    nextEvents: (e: EventItem) => string[]
  ): InnerFireResult {
    const branchPlaces: string[] = [];

    while (eventQueue.length > 0) {
      const event = eventQueue.shift();
      if (!event) {
        throw Error('Event is undefined');
      }

      // can fire?
      const transition = this.labelToTransitionMap.get(event.label);
      if (transition) {
        // fire
        for (const arc of preArcs(transition)) {
          const pIndex = this.getPlaceIndex(prePlace(arc));
          event.localMarking![pIndex] =
            event.localMarking![pIndex] - arc.weight;
          if (event.localMarking![pIndex] < 0) {
            validPlaces[pIndex] = false;
          }
        }

        for (const arc of postArcs(transition)) {
          const pIndex = this.getPlaceIndex(postPlace(arc));
          event.localMarking![pIndex] =
            event.localMarking![pIndex] + arc.weight;
        }
      }

      // push to first later and check for complex places
      const nextEventsToFire = nextEvents(event);
      if (nextEventsToFire.length > 0) {
        for (let i = 0; i < this.petriNet.places.length; i++) {
          if (nextEventsToFire.length > 1 && event.localMarking![i] > 0) {
            branchPlaces.push(this.petriNet.places[i].id);
          }
          const firstLater = [...nextEventsToFire][0];
          const firstLaterEvent = this.idToEventMap.get(
            firstLater
          ) as EventItem;
          firstLaterEvent!.localMarking![i] =
            firstLaterEvent!.localMarking![i] + event.localMarking![i];
        }
      }
    }

    return { branchPlaces };
  }

  private buildTotalOrder(partialOrder: PartialOrder): Array<EventItem> {
    const ordering = [...(partialOrder.initialEvents ?? [])];
    const contained = [...(partialOrder.initialEvents ?? [])];

    const eventsToCheck: Array<EventItem> = [...partialOrder.events];
    while (eventsToCheck.length > 0) {
      const event = eventsToCheck.shift();

      // The event is already contained in the ordering
      if (!event || contained.includes(event.id)) {
        continue;
      }

      let previousEventContained = true;
      for (const pre of event.previousEvents) {
        if (!contained.some((containedEvent) => containedEvent === pre)) {
          previousEventContained = false;
          break;
        }
      }

      if (previousEventContained) {
        ordering.push(event.id);
        contained.push(event.id);
      } else {
        eventsToCheck.push(event);
      }
    }

    return ordering.map((id) => {
      const eventItem = this.idToEventMap.get(id) as EventItem;

      eventItem.localMarking = new Array<number>(
        this.petriNet.places.length
      ).fill(0);

      return eventItem;
    });
  }

  private checkFlowForPlace(place: Place, events: Array<EventItem>): boolean {
    const n = events.length * 2 + 2;
    const SOURCE = 0;
    const SINK = n - 1;

    const network = new MaxFlowPreflowN3(n);

    for (let eIndex = 0; eIndex < events.length; eIndex++) {
      network.setUnbounded(eventStart(eIndex), eventEnd(eIndex));

      const event = events[eIndex];
      const transition = this.labelToTransitionMap.get(event.label);
      if (transition === undefined) {
        if (place.marking > 0) {
          network.setCap(SOURCE, eventEnd(eIndex), place.marking);
        }
      } else {
        for (const outArc of transition.outgoingArcs) {
          const postPlace = this.idToPlaceMap.get(outArc.target);
          if (postPlace === place) {
            network.setCap(SOURCE, eventEnd(eIndex), outArc.weight);
          }
        }
        for (const inArc of transition.incomingArcs) {
          const prePlace = this.idToPlaceMap.get(inArc.source);
          if (prePlace === place) {
            network.setCap(eventStart(eIndex), SINK, inArc.weight);
          }
        }
      }
      for (const postEvent of event.nextEvents) {
        network.setUnbounded(
          eventEnd(eIndex),
          eventStart(events.findIndex((e) => e.id === postEvent))
        );
      }
    }

    let need = 0;
    for (let ii = 0; ii < n; ii++) {
      need += network.getCap(ii, SINK);
    }
    const f = network.maxFlow(SOURCE, SINK);
    return need === f;
  }

  private getPlaceIndex(placeToCheck?: Place) {
    return this.petriNet.places.findIndex((place) => place === placeToCheck);
  }

  /**
* Fires the partial order in the net and returns the ids of invalid places.
* @returns The ids of invalid places.
*/
  getImplicitPlaces(): string[] {
    for (let index = 0; index < this.partialOrders.length; index++) {
      this.extractImplicitPlaces(index);
    }

    /* console.log(this.partialOrders); */
    const implicitPlaces: string[] = [];

    // Small adjustment that is needed, if there are any invalid places within the proces model
    for (let index = 0; index < this.partialOrders.length; index++) {
      if (this.partialOrders[index].events[this.partialOrders[index].events.length - 1].localMarking!.find((element) => element < 0)) {
        let a = this.partialOrders[index].events[this.partialOrders[index].events.length - 2].localMarking;
        let b = this.partialOrders[index].events[this.partialOrders[index].events.length - 1].localMarking;
        this.partialOrders[index].events[this.partialOrders[index].events.length - 2].localMarking = a!.map(function (item: number, index2: number) { return item - b![index2] });
        this.partialOrders[index].events[this.partialOrders[index].events.length - 1].localMarking = b!.map(function (item: number, index2: number) { return item - b![index2] });
      }
    }
    /* console.log(this.partialOrders); */

    // Build a list of all places including the corresponding local markings
    let placesAndMarkings = [];
    for (let i = 0; i < this.petriNet.places.length; i++) {
      placesAndMarkings.push({
        "place": this.petriNet.places[i].id, "localMarkings": [] as any[], "implicit": false
      });

      for (let index = 0; index < this.partialOrders.length; index++) {
        for (let j = 1; j < this.partialOrders[index].events.length; j++) {
          let localMarking = {
            "label": this.partialOrders[index].events[j].previousEvents[0],
            //"localMarking": this.partialOrders[index].events[j].localMarking![i]
            // Math.abs()
            "localMarking": this.partialOrders[index].events[j].localMarking![i] >= 0 ? this.partialOrders[index].events[j].localMarking![i] : 0
          };
          // Only add, if label does not already exist
          let k = placesAndMarkings[i].localMarkings.findIndex((item) => item.label === localMarking.label);
          if (k === -1) {
            placesAndMarkings[i].localMarkings.push(localMarking);
          }
          /* if (k > 0) {
            let z = placesAndMarkings[i].localMarkings.findIndex((item) => item.label !== this.partialOrders[index].events[j].label);
            if (z != -1 && placesAndMarkings[i].localMarkings[k].localMarking == 0) {
              placesAndMarkings[i].localMarkings[k].localMarking = localMarking.localMarking;// placesAndMarkings[i].localMarkings[k].localMarking - localMarking.localMarking;
            }
          } */
        }
      }
    }

    /* console.log("placesAndMarkings");
    console.log(placesAndMarkings); */
    // For loop to pair all places, but not a place with itself
    for (let i = 0; i < this.petriNet.places.length - 1; i++) {
      for (let j = i + 1; j < this.petriNet.places.length; j++) {
        /* console.log("Compare " + placesAndMarkings[i].place + " with " + placesAndMarkings[j].place); */

        // For loop to go then trough each local Marking to compare these values
        for (let k = 0; k < placesAndMarkings[i].localMarkings.length; k++) {
          // If we found a marking that is greater than another one, then mark it as possibly implicit
          if (placesAndMarkings[i].localMarkings[k].localMarking > placesAndMarkings[j].localMarkings[k].localMarking) {
            placesAndMarkings[i].implicit = true;

            // and start a for loop to check now all markings of it in detail
            for (let l = 0; l < placesAndMarkings[i].localMarkings.length; l++) {
              /* console.log(placesAndMarkings[i].localMarkings[l].localMarking + " ? " + placesAndMarkings[j].localMarkings[l].localMarking); */
              if (placesAndMarkings[i].localMarkings[l].localMarking < placesAndMarkings[j].localMarkings[l].localMarking) {
                placesAndMarkings[i].implicit = false;
              }
            }
           /*  console.log(placesAndMarkings[i].implicit); */
          }

          /* if (placesAndMarkings[i].localMarkings[k].localMarking < placesAndMarkings[j].localMarkings[k].localMarking) {
            placesAndMarkings[j].implicit = true;

            // and start a for loop to check now all markings of it in detail
            for (let l = 0; l < placesAndMarkings[i].localMarkings.length; l++) {
              console.log(placesAndMarkings[i].localMarkings[l].localMarking + " ? " + placesAndMarkings[j].localMarkings[l].localMarking);
              if (placesAndMarkings[i].localMarkings[l].localMarking > placesAndMarkings[j].localMarkings[l].localMarking) {
                placesAndMarkings[j].implicit = false;
              }
            }
            console.log(placesAndMarkings[j].implicit);
          } */

          /* if (placesAndMarkings[i].localMarkings[k].localMarking < placesAndMarkings[j].localMarkings[k].localMarking) {
            placesAndMarkings[j].implicit = true;
            let intermediatePlace = ({
              "place": placesAndMarkings[i].place, "localMarkings": [] as any[], "implicit": false
            });
            for (let l = 0; l < placesAndMarkings[j].localMarkings.length; l++) {
              console.log(placesAndMarkings[j].localMarkings[l].localMarking + " ?<? " + placesAndMarkings[i].localMarkings[l].localMarking);
              if (placesAndMarkings[i].localMarkings[l].localMarking > placesAndMarkings[j].localMarkings[l].localMarking) {
                placesAndMarkings[j].implicit = false;

              } // else if (placesAndMarkings[i].localMarkings[l].localMarking < placesAndMarkings[j].localMarkings[l].localMarking){
               // placesAndMarkings[j].implicit = true;
             // }

             console.log(placesAndMarkings[j].implicit);
             // Try to find another place that has the difference of p_i and p_j as markings. If so, then p_i is an implicit place
             if (placesAndMarkings[j].implicit == true) {
               for (let l = 0; l < placesAndMarkings[j].localMarkings.length; l++) {
                 let localMarking = {
                   "label": placesAndMarkings[j].localMarkings[l].label,
                   "localMarking": placesAndMarkings[j].localMarkings[l].localMarking - placesAndMarkings[i].localMarkings[l].localMarking
                 };
                 intermediatePlace.localMarkings.push(localMarking);
                }
                 // Search for it
                 const objSmallOrEqual = (o1: any, o2: any) => Object.keys(o1).length === Object.keys(o2).length && Object.keys(o1).every(p => o1[p] <= o2[p]);
                 let searchResult = false;
                 
                 for (let z = 0; z < this.petriNet.places.length; z++) {
                 searchResult = objSmallOrEqual(placesAndMarkings[z].localMarkings, intermediatePlace.localMarkings);
                 //console.log(placesAndMarkings[z]);
                 if (searchResult == true) {
                   if (placesAndMarkings[j].place == placesAndMarkings[z].place) {
                     searchResult = false;
                   }
                 }
                 }
                 if (searchResult == true) {
                   placesAndMarkings[j].implicit = true;
                 } else {
                   placesAndMarkings[j].implicit = false;
                 }
 
               
             }
           }
          } */

        }
      }
    }

    for (let i = 0; i < placesAndMarkings.length; i++) {
      if (placesAndMarkings[i].implicit == true) {
        implicitPlaces.push(placesAndMarkings[i].place)
      }
    }

    /* if (this.partialOrder.arcs[0].target == "b") {
      implicitPlaces.push("p1");
    } else {
      implicitPlaces.push("p2");
    } */

    let implicitPlacesWithoutDuplicates = Array.from(new Set(implicitPlaces));
    console.log("implicit places");
    console.log(implicitPlacesWithoutDuplicates);
    return implicitPlacesWithoutDuplicates;
  }

  extractImplicitPlaces(index: number) {

    this.buildExtensionForPartialOrder2(index);

    const totalOrder = this.buildTotalOrder(this.partialOrders[index]);

    // Adds the initial marking to the first event.
    const initialEvent = totalOrder[0];
    for (let i = 0; i < this.petriNet.places.length; i++) {
      initialEvent.localMarking![i] = this.petriNet.places[i].marking;
    }

    const validPlaces: ValidPlacesType = new Array(
      this.petriNet.places.length
    ).fill(true);
    const notValidPlaces = new Array(this.petriNet.places.length).fill(false);
    const { branchPlaces } = this.fireForwards([...totalOrder], validPlaces);

    // not valid places
    const finalEvent = this.idToEventMap.get(
      [...this.partialOrders[index].finalEvents!][0]
    );
    if (!finalEvent) {
      throw new Error('Final event not found');
    }

    for (let i = 0; i < this.petriNet.places.length; i++) {
      notValidPlaces[i] = finalEvent.localMarking![i] < 0;
    }

    // Don't fire all backwards!
    const backwardsFireQueue = [finalEvent];
    for (let i = totalOrder.length - 2; i >= 0; i--) {
      totalOrder[i].localMarking = new Array<number>(
        this.petriNet.places.length
      ).fill(0);
      backwardsFireQueue.push(totalOrder[i]);
    }

    const backwardsValidPlaces: ValidPlacesType = new Array(
      this.petriNet.places.length
    ).fill(true);

    // Is the final marking > 0 ?
    for (let i = 0; i < this.petriNet.places.length; i++) {
      if (finalEvent.localMarking![i] < 0) {
        backwardsValidPlaces[i] = false;
      }
    }

    this.fireBackwards(backwardsFireQueue, backwardsValidPlaces);

    // Rest with flow
    const flow = new Array(this.petriNet.places.length).fill(false);
    for (let i = 0; i < this.petriNet.places.length; i++) {
      if (
        !validPlaces[i] &&
        branchPlaces.includes(this.petriNet.places[i].id) &&
        !notValidPlaces[i] &&
        !backwardsValidPlaces[i]
      ) {
        flow[i] = this.checkFlowForPlace(
          this.petriNet.places[i],
          this.partialOrders[index].events
        );
      }
    }
  }

  /**
 * Builds the extension for a partial order with an initial and final event.
 * @private
 */
  private buildExtensionForPartialOrder2(index: number): void {
    const initial: EventItem = createEventItem('initial_marking');
    const finalEvent: EventItem = createEventItem('final_marking');

    this.partialOrders[index].events = [
      initial,
      ...this.partialOrders[index].events,
      finalEvent,
    ];
    this.partialOrders[index].events.forEach((e) => this.idToEventMap.set(e.id, e));

    this.partialOrders[index].initialEvents?.forEach((eventId) => {
      const foundEventItem = this.idToEventMap.get(eventId);
      if (foundEventItem) {
        concatEvents(initial, foundEventItem);
      } else {
        console.error(`Event with id ${eventId} not found`);
      }
    });

    this.partialOrders[index].finalEvents?.forEach((eventId) => {
      const foundEventItem = this.idToEventMap.get(eventId);
      if (foundEventItem) {
        concatEvents(foundEventItem, finalEvent);
      } else {
        console.error(`Event with id ${eventId} not found`);
      }
    });
    determineInitialAndFinalEvents(this.partialOrders[index]);
  }
}

function eventStart(eventIndex: number): number {
  return eventIndex * 2 + 1;
}

function eventEnd(eventIndex: number): number {
  return eventIndex * 2 + 2;
}

