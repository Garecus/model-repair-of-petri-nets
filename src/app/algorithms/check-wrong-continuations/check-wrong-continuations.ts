import clonedeep from 'lodash.clonedeep';
import {
  ArcList,
  CaseList,
  LogList,
  ModelList,
  PartialOrder,
  wrongContinuation,
} from '../../classes/diagram/partial-order';
import { PetriNet } from '../../classes/diagram/petri-net';
import { Place } from '../../classes/diagram/place';
import {
  EventItem,
  Transition,
} from '../../classes/diagram/transition';
import { PetriNetSolutionService } from '../regions/petri-net-solution.service';
import { FirePartialOrder } from '../fire-partial-orders/fire-partial-order';
import { ParserService } from 'src/app/services/parser/parser.service';

type InnerFireResult = { branchPlaces: string[] };
type ValidPlacesType = Array<boolean>;

export class CheckWrongContinuations {
  private readonly idToEventMap = new Map<string, EventItem>();
  private readonly idToPlaceMap = new Map<string, Place>();
  private readonly labelToTransitionMap = new Map<string, Transition>();
  private readonly petriNet: PetriNet;
  private readonly partialOrder: PartialOrder;
  private readonly partialOrders: PartialOrder[];

  LogListValues: LogList[] = [];
  ModelListValues: ModelList[] = [];
  caseList: CaseList[] = [];
  arcList: ArcList[] = [];
  arcList2: ArcList[] = [];
  allUniqueTransitions: string[] = [];
  allUniquePrefix: string[] = [];
  continuations: string[] = [];
  startVariable: string = "";
  endVariable: string = "";
  maxLoopNumber: number = 0;
  wrongContinuations: string[] = [];
  generatedCombinations: string[] = [];
  invalidTransitions: string[] = [];
  wcObjects: wrongContinuation[] = [];
  computingSolutions = false;
  removedContinuations: string[] = [];
  executableContinuations: string[] = [];

  constructor(petriNet: PetriNet, partialOrder: PartialOrder, partialOrders: PartialOrder[], private petriNetRegionsService: PetriNetSolutionService, private parserService: ParserService) {
    this.petriNet = { ...petriNet };
    this.partialOrder = clonedeep(partialOrder);
    this.partialOrders = clonedeep(partialOrders);
    this.petriNet.transitions.forEach((t) =>
      this.labelToTransitionMap.set(t.label, t)
    );
    this.petriNet.places.forEach((p) => this.idToPlaceMap.set(p.id, p));
  }

  /**
   * Generates all possible continuations and removes then duplicates, the ones that are included in the log and that can not be fired in the net
   * @returns the object of wrong continuations
   */
  getWrongContinuations(): wrongContinuation[] {
    for (let i = 0; i < this.partialOrders.length; i++) {
      let rowContent = "";
      for (let j = 0; j < this.partialOrders[i].arcs.length; j++) {
        let z = j - 1;
        if (z >= 0 && this.partialOrders[i].arcs[z].target.replace(/\d+/g, '') == this.partialOrders[i].arcs[j].source.replace(/\d+/g, '')) {
          rowContent += ',' + this.partialOrders[i].arcs[j].target.replace(/\d+/g, '');
        } else {
          rowContent += this.partialOrders[i].arcs[j].source.replace(/\d+/g, '') + ',' + this.partialOrders[i].arcs[j].target.replace(/\d+/g, '');
        }
      }

      let newRow: LogList = {
        rowId: i,
        rowContent: rowContent,
        caseId: i,
        name: rowContent,
      };
      this.LogListValues.push(newRow);

    }

    for (var i2 = 0; i2 < this.LogListValues.length; i2++) {
      const newEntry = this.caseList.find(item => item.caseId === this.LogListValues[i2].caseId);
      if (newEntry) {
        newEntry.sequence += this.LogListValues[i2].name;
      } else {
        this.caseList.push({ caseId: this.LogListValues[i2].caseId, sequence: this.LogListValues[i2].name });
      }
    }

    for (var i3 = 0; i3 < this.caseList.length; i3++) {
      let caseSplitted = this.caseList[i3].sequence.split(',');
      let caseUniqueTransitions = Array.from(new Set(caseSplitted));
      this.allUniqueTransitions = this.allUniqueTransitions.concat(caseUniqueTransitions);
      this.allUniqueTransitions = Array.from(new Set(this.allUniqueTransitions));

      let lastValue = "";
      let prefix = "";
      for (var i4 = 0; i4 < caseSplitted.length; i4++) {
        if (i4 == 0) {
          prefix = caseSplitted[i4];
        } else {
          prefix = lastValue + caseSplitted[i4];
        }
        lastValue = prefix + ',';
        this.allUniquePrefix.push(prefix);
      }
      this.allUniquePrefix = Array.from(new Set(this.allUniquePrefix));

      for (var i7 = 0; i7 < (this.allUniquePrefix.length * this.allUniqueTransitions.length); i7++) {
        const i5 = Math.floor(i7 / this.allUniqueTransitions.length);
        const i6 = i7 % this.allUniqueTransitions.length;
        this.continuations[i7] = this.allUniquePrefix[i5].concat(',' + this.allUniqueTransitions[i6]);
      }
      this.continuations = this.continuations.concat(this.allUniquePrefix);
      this.continuations = this.continuations.concat(this.allUniqueTransitions);
      this.continuations = Array.from(new Set(this.continuations));
    }

    // Remove the continuations that are equal to the specification traces from the continuations list
    const sequences = this.caseList.map(obj => obj.sequence);
    this.continuations = this.continuations.filter(obj => !sequences.includes(obj));

    let remove: string[] = [];
    for (let index = 0; index < this.continuations.length; index++) {
      for (let j = 0; j < sequences.length; j++) {
        if (sequences[j].includes(this.continuations[index])) {
          remove = remove.concat(this.continuations[index]);
        }
      }
    }
    this.continuations = this.continuations.filter(n => !remove.includes(n));

    // Check whether or not a continuation can be fired. If yes, then it is a wrongContinuation. If not, remove it.
    let parsedContinuations: PartialOrder[];
    for (let index = 0; index < this.continuations.length; index++) {
      parsedContinuations = this.parserService.parseWrongContinuation(this.continuations[index], new Set([""]));
      if (parsedContinuations.length > 0) {
        const currentInvalid = this.fireWrongContinuation(
          this.petriNet,
          parsedContinuations[0]
        );
        if (currentInvalid.length > 0) {
          // Remove it
          this.removedContinuations = this.removedContinuations.concat(this.continuations[index]);
        }
      }
    }
    this.continuations = this.continuations.filter(n => !this.removedContinuations.includes(n));
    this.wrongContinuations = this.continuations;

    // Sorting the wrong continuations  Z -> A
    this.wrongContinuations.sort((a, b) => b.localeCompare(a));

    // Check which wrong continuation can be repaired and which not
    let wcType = "unknown"
    for (let i = 0; i < this.wrongContinuations.length; i++) {
      let wcObject =
      {
        "id": i,
        "type": wcType,
        "wrongContinuation": this.wrongContinuations[i],
        "firstInvalidTransition": this.wrongContinuations[i].charAt(this.wrongContinuations[i].length - 1)
      };
      this.wcObjects.push(wcObject)
    }
    // Return the object array with wrong continuations
    return this.wcObjects;
  }

  /**
   * Identifies all invalid transitions based on the wrong continuations
   * @param wrongContinuations as object array
   * @returns a list of invalid transitions
   */
  getInvalidTransitions(wrongContinuations: wrongContinuation[]): string[] {
    let transitions: string[] = [];
    function identifyTransitions(inputArray: string[]): string[] {
      const followsArray: string[] = [];

      // Remove duplicates
      const uniqueFollowsArray = Array.from(new Set(followsArray));

      // Indentify events with no follows-relations
      const noFollowsArray: string[] = [];
      for (let i = 0; i < inputArray.length; i++) {
        const currentString = inputArray[i];

        if (!followsArray.some(letter => currentString.includes(letter))) {
          // Get the transition that is the first invali transition of the wrong continuation (using -2 would give us the last valid one)
          const lastLetter = currentString.charAt(currentString.length - 1);
          noFollowsArray.push(lastLetter);
        }
      }

      // Remove duplicates
      const uniqueNoFollowsArray = Array.from(new Set(noFollowsArray));

      // Combine the arrays
      let resultArray = [...uniqueFollowsArray, ...uniqueNoFollowsArray];
      resultArray = Array.from(new Set(resultArray));
      return resultArray;
    }

    let wrongContinuationsString = wrongContinuations.map(a => a.wrongContinuation);
    transitions = identifyTransitions(wrongContinuationsString);
    // Sort by Z -> A
    transitions.sort((a, b) => b.localeCompare(a));
    // Alternative approach: Show only 1 at a time right now, then: transitions = [transitions[0]];
    return transitions;
  }

  /**
 * Fire the net with the partial orders to get all invalid places
 * @param petriNet 
 * @param continuation
 * @returns list of invalid places
 */
  private fireWrongContinuation(
    petriNet: PetriNet,
    continuation: PartialOrder
  ): string[] {
    return new FirePartialOrder(petriNet, continuation, []).getInvalidPlaces();
  }

}