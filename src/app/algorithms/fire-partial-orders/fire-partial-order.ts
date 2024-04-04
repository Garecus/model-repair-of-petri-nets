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
      /* console.log(totalOrder[i])
      console.log(totalOrder[i].localMarking); */
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

    /*     return this.petriNet.places
          .filter((p, i) => {
            if (validPlaces[i]) {
              return false;
            } else if (backwardsValidPlaces[i]) {
              return false;
            } else return !flow[i];
          })
          .map((p) => p.id); */

    const implicitPlaces: string[] = [];
    console.log(this.partialOrder);
    let placesAndMarkings = [];
    for (let i = 0; i < this.petriNet.places.length; i++) {
      placesAndMarkings.push({
        "place": this.petriNet.places[i].id, "localMarkings": [{
          "label": "",
          "localMarking": initialEvent.localMarking![i]
        }], "implicit": false
      });
      /* for (let k = 0; k < this.petriNet.transitions.length - 1; k++) {
         for (let l = totalOrder.length -1; l >=0 ; l--) {
        let localMarking = {
          "label": this.petriNet.transitions[k].label,
          "localMarking": totalOrder[l].localMarking![i]  //XXX other markings must be added here too
        };
        placesAndMarkings[i].localMarkings.push(localMarking);
      } 
     } */
      for (let l = 2; l < this.partialOrder.events.length; l++) {
        let localMarking = {
          "label": this.partialOrder.events[l].previousEvents[0],
          "localMarking": this.partialOrder.events[l].localMarking![i]
        };
        placesAndMarkings[i].localMarkings.push(localMarking);
      }
      /* let localMarking = {
        "label": this.petriNet.transitions[this.petriNet.transitions.length - 1].label,
        "localMarking": finalEvent.localMarking![i]
      };
      placesAndMarkings[i].localMarkings.push(localMarking); */
    }
    console.log("placesAndMarkings");
    console.log(placesAndMarkings);
    // For loop to pair all places, but not a place with itself
    for (let i = 0; i < this.petriNet.places.length - 1; i++) {
      for (let j = i + 1; j < this.petriNet.places.length; j++) {
        console.log("Compare " + placesAndMarkings[i].place + " with " + placesAndMarkings[j].place);

        /* loop1: */ for (let k = 0; k < placesAndMarkings[i].localMarkings.length; k++) {
          /* console.log(placesAndMarkings[i].localMarkings[k].localMarking + " <=> " + placesAndMarkings[j].localMarkings[k].localMarking); */
          if (placesAndMarkings[i].localMarkings[k].localMarking > placesAndMarkings[j].localMarkings[k].localMarking) { //XXX One marking must be greater. All other must be greater or equal
            placesAndMarkings[i].implicit = true;
            let intermediatePlace = ({
              "place": "p_search", "localMarkings": [] as any[]
            });
            /* loop2: */ for (let l = 0; l < placesAndMarkings[i].localMarkings.length; l++) {
              console.log(placesAndMarkings[i].localMarkings[l].localMarking + " ?<? " + placesAndMarkings[j].localMarkings[l].localMarking);
              if (placesAndMarkings[i].localMarkings[l].localMarking < placesAndMarkings[j].localMarkings[l].localMarking) {
                placesAndMarkings[i].implicit = false;
                /* break loop1; */
              } /* else if (placesAndMarkings[i].localMarkings[l].localMarking > placesAndMarkings[j].localMarkings[l].localMarking){
                placesAndMarkings[i].implicit = true;
              } */
            }
            console.log(placesAndMarkings[i].implicit);
            // Try to find another place that has the difference of p_i and p_j as markings. If so, then p_i is an implicit place
            if (placesAndMarkings[i].implicit == true) {
              for (let l = 0; l < placesAndMarkings[i].localMarkings.length; l++) {
                let localMarking = {
                  "label": placesAndMarkings[i].localMarkings[l].label,
                  "localMarking": placesAndMarkings[i].localMarkings[l].localMarking - placesAndMarkings[j].localMarkings[l].localMarking
                };
                intermediatePlace.localMarkings.push(localMarking);
              }
              // Search for it
              const objSmallOrEqual = (o1: any, o2: any) => Object.keys(o1).length === Object.keys(o2).length && Object.keys(o1).every(p => o1[p] <= o2[p]);
              //const objSmallOrEqual = (o1: any, o2: any) => o1.length === o2.length && o1.every((p: number) => o1[p] <= o2[p]);
              let searchResult = true;
              for (let z = 0; z < this.petriNet.places.length; z++) {
                /* searchResult = objSmallOrEqual(placesAndMarkings[z].localMarkings, intermediatePlace.localMarkings); */
                for (let y = 0; y < placesAndMarkings[z].localMarkings.length; y++) {
                  if (placesAndMarkings[z].localMarkings[y].localMarking > intermediatePlace.localMarkings[y].localMarking) {
                    searchResult = false;
                  }/*  else {
                  searchResult = true;
                } */
                }
                if (searchResult == true) {
                  if (placesAndMarkings[i].place == placesAndMarkings[z].place) {
                    searchResult = false;
                  }
                } else if (searchResult == false) {
                  console.log(placesAndMarkings)
                  if (placesAndMarkings[j].localMarkings == placesAndMarkings[z].localMarkings && placesAndMarkings[j].place != placesAndMarkings[z].place) {
                    console.log(placesAndMarkings[z].place);
                    searchResult = true;
                  }
                }
              }
              if (searchResult == true) {
                placesAndMarkings[i].implicit = true;
              } else {
                placesAndMarkings[i].implicit = false;
              }
            }
          }

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

    /*     let finalEvent: any;
        let identifiedPlaces = [];
        let implicitPlaces = [];
        for (let index = 0; index < this.partialOrders.length; index++) {
          this.buildExtensionForPartialOrder2(this.partialOrders[index]);
    
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
          finalEvent = this.idToEventMap.get(
            [...this.partialOrders[index].finalEvents!][0]
          );
          if (!finalEvent) {
            throw new Error('Final event not found');
          }
    
          // Iterate trough all places and compare them with each other
          for (let i = 0; i < this.petriNet.places.length - 1; i++) {
            for (let j = i + 1; j < this.petriNet.places.length; j++) {
              // Avoid to mark invalid places
              if (finalEvent.localMarking![i] >= 0 && finalEvent.localMarking![j] >= 0) {
                console.log("Place " + this.petriNet.places[i].id + " with " + finalEvent.localMarking![i] + " | Place " + this.petriNet.places[j].id + " with " + finalEvent.localMarking![j])
                if (finalEvent.localMarking![i] > finalEvent.localMarking![j]) {
                  let index2 = identifiedPlaces.findIndex((item) => item.place == this.petriNet.places[i].id);
                  if (index2 === -1) {
                    identifiedPlaces.push({ "place": this.petriNet.places[i].id, "probablyImplicit": true, "greaterThan": [this.petriNet.places[j].id] });
                  } else {
                    identifiedPlaces[index2].greaterThan.push(this.petriNet.places[j].id);
                  }
                }
    
                if (finalEvent.localMarking![i] < finalEvent.localMarking![j]) {
                  let index2 = identifiedPlaces.findIndex((item) => item.place == this.petriNet.places[j].id);
                  if (index2 === -1) {
                    identifiedPlaces.push({ "place": this.petriNet.places[j].id, "probablyImplicit": true, "greaterThan": [this.petriNet.places[i].id] });
                  } else {
                    identifiedPlaces[index2].greaterThan.push(this.petriNet.places[i].id);
                  }
                }
              }
            }
          }
        }
    
        for (let i = 0; i < identifiedPlaces.length; i++) {
          if (identifiedPlaces[i].probablyImplicit == true && identifiedPlaces[i].greaterThan?.length == this.petriNet.places.length - 1) {
            //for (let j = i + 1; i < identifiedPlaces.length; j++) {
              console.log(identifiedPlaces[i]);
              //if (identifiedPlaces[i].greaterThan.includes(identifiedPlaces[j].place) && identifiedPlaces[j].greaterThan.includes(identifiedPlaces[i].place)) {
    
              //} else {
                implicitPlaces.push(identifiedPlaces[i].place);
           //   }
           // }
          }
        }
        let implicitPlaces2 = Array.from(new Set(implicitPlaces));
        console.log("implicit places");
        console.log(implicitPlaces2);
        return implicitPlaces2; */

  }

  /**
 * Builds the extension for a partial order with an initial and final event.
 * @private
 */
  private buildExtensionForPartialOrder2(partialOrder: PartialOrder): void {
    const initial: EventItem = createEventItem('initial_marking');
    const finalEvent: EventItem = createEventItem('final_marking');

    partialOrder.events = [
      initial,
      ...partialOrder.events,
      finalEvent,
    ];
    partialOrder.events.forEach((e) => this.idToEventMap.set(e.id, e));

    partialOrder.initialEvents?.forEach((eventId) => {
      const foundEventItem = this.idToEventMap.get(eventId);
      if (foundEventItem) {
        concatEvents(initial, foundEventItem);
      } else {
        console.error(`Event with id ${eventId} not found`);
      }
    });

    partialOrder.finalEvents?.forEach((eventId) => {
      const foundEventItem = this.idToEventMap.get(eventId);
      if (foundEventItem) {
        concatEvents(foundEventItem, finalEvent);
      } else {
        console.error(`Event with id ${eventId} not found`);
      }
    });
    determineInitialAndFinalEvents(partialOrder);
  }
}

function eventStart(eventIndex: number): number {
  return eventIndex * 2 + 1;
}

function eventEnd(eventIndex: number): number {
  return eventIndex * 2 + 2;
}