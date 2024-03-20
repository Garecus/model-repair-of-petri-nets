import clonedeep from 'lodash.clonedeep';
import { Arc } from '../../classes/diagram/arc';
import {
  ArcList,
  CaseList,
  determineInitialAndFinalEvents,
  LogList,
  ModelList,
  PartialOrder,
  wrongContinuation,
} from '../../classes/diagram/partial-order';
import { PetriNet } from '../../classes/diagram/petri-net';
import { Place } from '../../classes/diagram/place';
import {
  concatEvents,
  createEventItem,
  EventItem,
  Transition,
} from '../../classes/diagram/transition';
import { forEach } from 'jszip';
import { VariableBinding } from '@angular/compiler';
import { PetriNetSolutionService } from '../regions/petri-net-solution.service';
import { PrecisionSolution } from 'src/app/services/repair/repair.model';
import { map, startWith, tap } from 'rxjs';

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
  startVariable: any;
  endVariable: any;
  maxLoopNumber: any;
  wrongContinuations: string[] = [];
  generatedCombinations: string[] = [];
  invalidTransitions: string[] = [];
  wcObjects: wrongContinuation[] = [];
  computingSolutions = false;

  constructor(petriNet: PetriNet, partialOrder: PartialOrder, partialOrders: PartialOrder[], private petriNetRegionsService: PetriNetSolutionService) {
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
  getWrongContinuations(): wrongContinuation[] {
    console.log("Start wrong continuations check.");
    /* console.log(this.partialOrders); */
    for (let i = 0; i < this.partialOrders.length; i++) {
      let rowContent = "";
      for (let j = 0; j < this.partialOrders[i].arcs.length; j++) {
        let z = j - 1;
        if (z >= 0 && this.partialOrders[i].arcs[z].target.replace(/\d+/g, '') == this.partialOrders[i].arcs[j].source.replace(/\d+/g, '')) {
          rowContent += this.partialOrders[i].arcs[j].target.replace(/\d+/g, '');
        } else {
          rowContent += this.partialOrders[i].arcs[j].source.replace(/\d+/g, '') + this.partialOrders[i].arcs[j].target.replace(/\d+/g, '');
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
    /* console.log(this.LogListValues); */
    for (var i2 = 0; i2 < this.LogListValues.length; i2++) {
      const newEntry = this.caseList.find(item => item.caseId === this.LogListValues[i2].caseId);
      if (newEntry) {
        newEntry.sequence += this.LogListValues[i2].name;
        /* console.log(newEntry.sequence); */
      } else {
        this.caseList.push({ caseId: this.LogListValues[i2].caseId, sequence: this.LogListValues[i2].name });
      }
    }
    /*     this.caseList.forEach((object, index) => {
          console.log(`Object ${index + 1}:`, object);
        }); */

    for (var i3 = 0; i3 < this.caseList.length; i3++) {
      let caseSplitted = this.caseList[i3].sequence.split('');
      /* console.log("Transitions of Case " + (i3 + 1) + ": " + caseSplitted); */
      let caseUniqueTransitions = Array.from(new Set(caseSplitted));
      /* console.log("Unique transitions of Case " + (i3 + 1) + ": " + caseUniqueTransitions); */
      this.allUniqueTransitions = this.allUniqueTransitions.concat(caseUniqueTransitions);
      this.allUniqueTransitions = Array.from(new Set(this.allUniqueTransitions));
      /* console.log("Overall unique transitions: " + this.allUniqueTransitions); */

      let lastValue = "";
      let prefix = "";
      for (var i4 = 0; i4 < caseSplitted.length; i4++) {
        if (i4 == 0) {
          prefix = caseSplitted[i4];
        } else {
          prefix = lastValue + caseSplitted[i4];
        }
        lastValue = prefix;
        /* console.log(prefix); */
        this.allUniquePrefix.push(prefix);
      }
      this.allUniquePrefix = Array.from(new Set(this.allUniquePrefix));
      /* console.log("Eindeutige Prefixliste: " + this.allUniquePrefix); */

      for (var i7 = 0; i7 < (this.allUniquePrefix.length * this.allUniqueTransitions.length); i7++) {
        const i5 = Math.floor(i7 / this.allUniqueTransitions.length);
        const i6 = i7 % this.allUniqueTransitions.length;
        this.continuations[i7] = this.allUniquePrefix[i5].concat(this.allUniqueTransitions[i6]);
      }
      this.continuations = this.continuations.concat(this.allUniquePrefix);
      this.continuations = Array.from(new Set(this.continuations));
      /* console.log(this.continuations); */
    }

    this.maxLoopNumber = 0;
    // Identify loop and store highest number
    for (const item of this.caseList) {
      const sequence = item.sequence;
      let consecutiveCount = 1;
      let prevChar = sequence.charAt(0);

      for (let i = 1; i < sequence.length; i++) {
        const currChar = sequence.charAt(i);
        if (currChar === prevChar) {
          consecutiveCount++;
        } else {
          this.maxLoopNumber = Math.max(this.maxLoopNumber, consecutiveCount);
          consecutiveCount = 1;
          prevChar = currChar;
        }
      }
    }
    /* console.log("Loopanzahl: " + this.maxLoopNumber); */

    // List of arcs in petri net
    /* console.log("Start with petri net");
    console.log(this.petriNet); */

    for (let i = 0; i < this.petriNet.arcs.length; i++) {
      const arc = {
        weight: this.petriNet.arcs[i].weight || 1,
        source: this.petriNet.arcs[i].source,
        target: this.petriNet.arcs[i].target,
        breakpoints: this.petriNet.arcs[i].breakpoints,
      };

      let newRow: ModelList = {
        rowId: i,
        rowContent: this.petriNet.arcs[i].source + " " + this.petriNet.arcs[i].target
      };
      this.ModelListValues.push(newRow);
    }

    /* console.log("Parsed Model: " + this.ModelListValues); */
    for (var i2 = 0; i2 < this.ModelListValues.length; i2++) {
      const newEntry = this.arcList.find(item => item.arc === this.ModelListValues[i2].rowContent);
      if (newEntry) {
        newEntry.arc += this.ModelListValues[i2].rowContent;
        /* console.log(newEntry.arc); */
      } else {
        this.arcList.push({ arc: this.ModelListValues[i2].rowContent });
      }
    }
    /*     this.arcList.forEach((object, index) => {
          console.log(`Object ${index + 1}:`, object);
        }); */

    // convert arcs to same sequences
    this.arcList2 = [];
    let highestNumberWithP = 0;

    for (var i3 = 0; i3 < this.arcList.length; i3++) {
      let arcSplitted = this.arcList[i3].arc.split(' ');
      /* console.log(arcSplitted[0]);
      console.log(arcSplitted[1]); */

      if (arcSplitted[0] == "p0") {
        let newRow: ArcList = {
          arc: arcSplitted[1],
        };
        this.arcList2.push(newRow);
        /* console.log(newRow); */
        // Identify start variable
        this.startVariable = arcSplitted[1];
      }

      // Identify end variable
      if (arcSplitted[0].includes("p") || arcSplitted[1].includes("p")) {
        let numberString = this.arcList[i3].arc.split("p")[1];
        numberString = numberString.split(" ")[0];
        /* console.log(numberString); */
        const number = parseInt(numberString, 10);
        if (!isNaN(number) && number > highestNumberWithP) {
          highestNumberWithP = number;
        }
      }

      // if the arc contains a starting p then check whether there is an ending arc with the same p, then remove the found arc and replace the p with the transitions of the found arc
      if (arcSplitted[1].includes("p")) {
        this.arcList = this.arcList.filter(element => {
          const arcSearchSplitted = element.arc.split(' ');
          if (arcSearchSplitted[0].includes(arcSplitted[1])) {
            let newRow: ArcList = {
              arc: arcSplitted[0] + arcSearchSplitted[1],
            };
            this.arcList2.push(newRow);
            /* console.log(newRow); */
            //return false;
            return true;
          } else {
            return true;
          }
        });
      }

      /* this.arcList2.forEach((object, index) => {
         console.log(`Object ${index + 1}:`, object);
       }); */
    }

    let lineWithHighestNumber: string | null = null;
    // End variable
    for (let i3 = this.arcList.length - 1; i3 >= 0; i3--) {
      const arc = this.arcList[i3].arc;
      if (arc.includes('p' + highestNumberWithP)) {
        lineWithHighestNumber = arc;
        if (lineWithHighestNumber) {
          const parts = lineWithHighestNumber.split(' ');
          this.endVariable = parts[1];
        }
        break;
      }
    }

    /*     console.log("Startvariable: " + this.startVariable);
        console.log("Endvariable: " + this.endVariable); */

    // Build further strings based on the connected letters
    // a, ab, ac, bb, bc, abc, abbc, abbbc, abbbbc
    function generateCombinations(entries: ArcList[], startVariable: string, endVariable: string, maxBb: number = 10): string[] {
      // Filter out entries consisting of a single letter
      const filteredEntries = entries.filter(entry => entry.arc.length > 1);

      // Check if any entry contains 'bb'
      /* const bbInEntries = filteredEntries.some(entry => entry.arc.includes('bb')); */
      const regex = /(.)\1+/;
      const bbInEntries = filteredEntries.some(entry => regex.test(entry.arc));

      let repeatingLetters = filteredEntries.map(entry => {
        const match = entry.arc.match(regex);
        return match ? match[1] : null;
      })

      repeatingLetters = repeatingLetters.filter(letter => letter !== null);

      // Generate combinations without additional 'b's first
      const combinationsWithoutBs: string[] = [];
      for (let i = 0; i < filteredEntries.length; i++) {
        const firstEntry = filteredEntries[i].arc;

        for (let j = 0; j < filteredEntries.length; j++) {
          const secondEntry = filteredEntries[j].arc;

          // Check if the combination starts with the start variable and ends with the end variable
          if (firstEntry[0] === startVariable && secondEntry[secondEntry.length - 1] === endVariable && firstEntry[firstEntry.length - 1] === secondEntry[0]) {
            // Allow combining an entry with itself to create repeated sequences
            let newEntry = firstEntry + secondEntry.slice(1);
            combinationsWithoutBs.push(newEntry);
          }
        }
      }

      // Add additional 'b's to combinations containing 'bb' until the maxBb limit is reached
      let finalCombinations: string[] = [];
      let stopWhile = false;
      if (bbInEntries) {
        for (const combination of combinationsWithoutBs) {
          let newCombinations: string[] = [combination];
          const regex2 = new RegExp(`(${repeatingLetters[0]})\\1+`);
          while ((newCombinations[0].match(/b/g) || []).length < maxBb) {
            const newEntries: string[] = [];
            /* if (stopWhile === true) {
              break;
            } */
            for (const newCombination of newCombinations) {
              let bIndex: number = 0;
              if (repeatingLetters[0] !== null) {
                bIndex = newCombination.indexOf(repeatingLetters[0]);
              } else {
                bIndex = newCombination.indexOf('');
              }
              const firstPart = newCombination.slice(0, bIndex + 1);
              const secondPart = newCombination.slice(bIndex + 1);
              if ((newCombinations[0].match(/b/g) || []).length === maxBb - 1) {
                newEntries.push(firstPart + repeatingLetters[0] + secondPart);
                newEntries[newEntries.length - 1] = newEntries[newEntries.length - 1].substring(0, newEntries[newEntries.length - 1].length - 1);
                /* newCombinations = newEntries;
                finalCombinations = finalCombinations.concat(newCombinations); */
                /* stopWhile = true; */
              } else {
                newEntries.push(firstPart + repeatingLetters[0] + secondPart);
              }
              console.log(newEntries[newEntries.length - 1]);
              /* const newCombinationCandidate = firstPart + secondPart;
              if (!newEntries.includes(newCombinationCandidate)) {
                newEntries.push(newCombinationCandidate);
              } */
            }
            newCombinations = newEntries;
            finalCombinations = finalCombinations.concat(newCombinations);
          }
        }
      } else {
        finalCombinations = combinationsWithoutBs;
      }

      // Add the base combination "abc" constructed using the same logic as other combinations
      const baseCombination = startVariable + endVariable;
      if (!finalCombinations.includes(baseCombination)) {
        finalCombinations.push(baseCombination);
      }

      // Remove duplicates from the final combinations
      const uniqueCombinations = Array.from(new Set(finalCombinations));

      return uniqueCombinations;
    }

    // Combine all initialEvents and finalEvents
    for (let i10 = 0; i10 < this.partialOrders.length; i10++) {

      // Remove duplicates
      let allStartsOfSinglePartialOrder = this.partialOrders[0].initialEvents;
      allStartsOfSinglePartialOrder = allStartsOfSinglePartialOrder?.filter((value: any, index: any, self: string | any[]) => self.indexOf(value) === index);

      let allEndsOfSinglePartialOrder = this.partialOrders[0].finalEvents;
      allEndsOfSinglePartialOrder = allEndsOfSinglePartialOrder?.filter((value, index, self) => self.indexOf(value) === index);

      for (let i11 = 0; i11 < (allStartsOfSinglePartialOrder ?? []).length; i11++) {
        // Convert it to a single string
        this.startVariable = (allStartsOfSinglePartialOrder ?? [])[i11];
        this.endVariable = (allEndsOfSinglePartialOrder ?? [])[i11];
        // Generate combinations with a default maximum of x 'bb's
        this.generatedCombinations = [...this.generatedCombinations, ...generateCombinations(this.arcList2, this.startVariable, this.endVariable, this.maxLoopNumber + 1)];
        this.generatedCombinations = this.generatedCombinations?.filter((value, index, self) => self.indexOf(value) === index); // self.indexOf(value) === index)
      }
    }

    // Output the generated combinations
    /* console.log("Generated Combinations:", generatedCombinations); */

    // Compare the lists
    // generatedCombinations minus event log this.caseList.sequence = wrong continuations
    const sequences = this.caseList.map(obj => obj.sequence);
    //console.log(sequences);
    this.wrongContinuations = this.generatedCombinations.filter(obj => !sequences.includes(obj));
    //console.log(this.wrongContinuations);
    // If c is getting the token from a place after b, then it is no wrong continuation
    this.wrongContinuations = this.wrongContinuations.filter((currentWC) => {
      console.log("Check arcs of WC: " + currentWC);
      let lastValidTransition = currentWC.charAt(currentWC.length - 2);
      let firstInvalidTransition = currentWC.charAt(currentWC.length - 1);
      const isMatching = this.petriNet.arcs.some(arc => {

        //XXX Can this be removed?
        if (currentWC == "abbbb") {
          let wcSplitted = currentWC.split('');
          for (let i = wcSplitted.length; i >= 0; i--) {
            if (lastValidTransition == wcSplitted[i]) {
              currentWC = currentWC.slice(0, i + 1) + wcSplitted[wcSplitted.length - 1];
            }
          }
        }

        if (arc.target === firstInvalidTransition && (currentWC.charAt(currentWC.length - 3) != lastValidTransition || currentWC.charAt(currentWC.length - 2) != lastValidTransition)) {
          console.log(currentWC);
          console.log("last valid: " + lastValidTransition);
          console.log("first invalid: " + firstInvalidTransition);
          console.log("1. Depth source: " + arc.source);
          console.log("1. Depth target: " + arc.target);
          const isPlaceSource = arc.source.startsWith('p') && !isNaN(parseInt(arc.source.substring(1)));
          if (isPlaceSource) {
            let firstArcSource = arc.source;
            const otherArcWithSameTarget = this.petriNet.arcs.find((anotherArc) => anotherArc.target === firstArcSource);
            console.log(otherArcWithSameTarget);
            if (otherArcWithSameTarget) {
              let secondArcSource = otherArcWithSameTarget.source;
              console.log(secondArcSource);
              const check = /* (secondArcSource === lastValidTransition || secondArcSource === firstInvalidTransition) && */ this.petriNet.arcs.some((otherArc) => {
                console.log("2. Depth Source: " + otherArc.source);
                console.log("2. Depth Target2: " + otherArc.target);
                // If no self loop
                if (secondArcSource === lastValidTransition) {
                  let check3 = otherArc.target === firstInvalidTransition && otherArc.source != firstArcSource;
                  return check3;
                } else { // If self loop
                  let check3 = otherArc.target === lastValidTransition && otherArc.source != firstArcSource;
                  return check3;
                }

              });
              return check;
            }
            return;
          } else {
            const check1 = arc.source === lastValidTransition && arc.target === firstInvalidTransition;
            const check2 = this.petriNet.arcs.some((otherArc) => otherArc.target === firstInvalidTransition && otherArc.source === lastValidTransition);
            return check1 && check2;
          }
        } else {
          return;
        }
      });
      console.log("Total:" + !isMatching);
      return !isMatching;

    });

    this.wrongContinuations.sort((a, b) => b.localeCompare(a)); //XXX change sorting (maybe) later again
    console.log(this.wrongContinuations);
    /*     for (let i12 = 0; i12 < this.wrongContinuations.length; i12++) {
          if (BB >= this.maxLoopNumber) {
            let j = 3;
            this.wrongContinuations[i12] = this.wrongContinuations[i12].slice(0,j);
          }
        } */

    /* console.log("Wrong continuations: " + this.wrongContinuations);
    console.log("Possible continuations based on the log: " + this.continuations); */

    // Dann reparierbar und nicht reparierbar bestimmen. via if b < b-eventlog, dann nicht reparierbar und wenn b > min und max aus event log, dann auch nicht, aber über max schon
    const repairableContinuations: string[] = [];
    const notRepairableContinuations: string[] = [];

    /* console.log("Wrong continuations (repairable): " + repairableContinuations);
    console.log("Wrong continuations (not repairable): " + notRepairableContinuations); */

    // Adjust petri net to add to the transition the marker to show the hint in the drawing
    /* this.petriNet.transitions[1].issueStatus = 'warning'; */

    // Get the transitions
    /*     if (mode == "getTransitions"){
          return this.invalidTransitions;
        } */

    let wcType = "repairable"
    for (let i = 0; i < this.wrongContinuations.length; i++) {
      //XXX
      /* let checkRepair = this.petriNetRegionsService
        .computePrecisionSolutions(this.partialOrders, net, invalidPlaces, invalidTransitions, this.wrongContinuations)
        .pipe(
          tap(() => (this.computingSolutions = false)),
          map((solutions) => ({
            solutions,
            renderChanges: false,
          })),
          startWith({
            solutions: [] as PrecisionSolution[],
            renderChanges: false,
          })
        );
      if (checkRepair) {
        wcType = "repairable";
      } */
      if (this.wrongContinuations[i] == "abbc") { //XXX
        wcType = "not repairable";
      } else {
        wcType = "repairable";
      }
      let wcObject =
      {
        "id": i,
        "type": wcType,
        "wrongContinuation": this.wrongContinuations[i],
        "firstInvalidTransition": this.wrongContinuations[i].charAt(this.wrongContinuations[i].length - 1)
      };

      this.wcObjects.push(wcObject)

    }
    console.log(this.wcObjects);

    // Dann Anzeigen von Lösungen
    /* return ["ac","abbbb"]; */
    return this.wcObjects;//this.wrongContinuations; 
  }

  getInvalidTransitions(wrongContinuations: wrongContinuation[]): string[] {
    let transitions: string[] = [];
    function identifyTransitions(inputArray: string[]): string[] {
      const followsArray: string[] = [];

      // Identify letters that follow the same letter (event loops)
      // This part is not needed, if we mark the first invalid instead of the last valid transition
      /* for (let i = 0; i < inputArray.length; i++) {
        const currentString = inputArray[i];

        for (let j = 0; j < currentString.length - 1; j++) {
          if (currentString[j] === currentString[j + 1]) {
            followsArray.push(currentString[j]);
          }
        }
      } */

      // Remove duplicates
      const uniqueFollowsArray = Array.from(new Set(followsArray));

      // Indentify events with no follows-relations
      const noFollowsArray: string[] = [];
      for (let i = 0; i < inputArray.length; i++) {
        const currentString = inputArray[i];

        if (!followsArray.some(letter => currentString.includes(letter))) {
          const lastLetter = currentString.charAt(currentString.length - 1); // const lastLetter = currentString.charAt(currentString.length - 2); //YYY
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
    /* transitions.sort((a, b) => a.localeCompare(b)); */
    //XXX Show only 1 at a time right now:
    console.log("Invalid Transitions");
    console.log(transitions);
    //transitions = [transitions[0]];
    //YYY
    return transitions;
  }
}