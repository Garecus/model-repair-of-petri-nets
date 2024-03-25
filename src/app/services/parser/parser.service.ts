import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { Arc, Breakpoint } from 'src/app/classes/diagram/arc';

import {
  addArc,
  addEventItem,
  addPlace,
  addTransition,
  generateEventItem,
  getElementsWithArcs,
  setRefs,
} from '../../classes/diagram/functions/net-helper.fn';
import {
  determineInitialAndFinalEvents,
  PartialOrder,
  LogList,
  CaseList,
  ArcList,
  ModelList,
} from '../../classes/diagram/partial-order';
import { PetriNet } from '../../classes/diagram/petri-net';
import { Place } from '../../classes/diagram/place';
import { concatEvents, Transition } from '../../classes/diagram/transition';
import {
  arcsAttribute,
  attributesAttribute,
  caseIdAttribute,
  conceptNameAttribute,
  eventIdAttribute,
  eventsAttribute,
  followsAttribute,
  logTypeKey,
  netTypeKey,
  placesAttribute,
  transitionsAttribute,
} from './parsing-constants';
import { sequence } from '@angular/animations';

type ParsingStates = 'initial' | 'type' | 'transitions' | 'places' | 'arcs';

type LogParsingStates = 'initial' | 'type' | 'attributes' | 'events';

@Injectable({
  providedIn: 'root',
})
export class ParserService { //XXX
  constructor(private toastr: ToastrService) { }

  private readonly transitionRegex = /^(\S*)\s*(.*)$/;
  private readonly placeRegex = /^(\S*)\s*(\d*)$/;
  private readonly arcRegex = /^(\S*)\s*(\S*)\s*(\d*)$/;

  private readonly logEventRegex = /^(\S+)\s*(\S+)\s*(\S+)?\s*(.*)$/;

  parsePartialOrders(content: string, errors: Set<string>): PartialOrder[] {
    const contentLines = content.split('\n');

    let currentParsingState: LogParsingStates = 'initial';

    let caseIdIndex = 0;
    let conceptNameIndex = 1;
    let eventIdIndex = -1;
    let followsIndex = -1;
    let attributesCounter = 1;

    let currentCaseId: number | undefined;

    const returnList: PartialOrder[] = [];
    let currentPartialOrder: PartialOrder | undefined;
    let lastCaseId: string | undefined;

    for (const line of contentLines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '') {
        continue;
      }

      switch (currentParsingState) {
        case 'initial':
          if (trimmedLine === logTypeKey) {
            currentParsingState = 'type';
          } else {
            errors.add(
              `The type of the file with the net has to be '` + netTypeKey + `'`
            );
            this.toastr.error(
              `The type has to be '` + netTypeKey + `'`,
              `Unable to parse file`
            );
            return [];
          }
          break;
        case 'type':
          if (trimmedLine === attributesAttribute) {
            currentParsingState = 'attributes';
            break;
          } else {
            errors.add(`The log contains invalid parts`);
            this.toastr.error(
              `The log contains invalid parts. '${trimmedLine}' is not a valid attribute`,
              `Unable to parse log`
            );
            return [];
          }
        case 'attributes':
          if (trimmedLine !== eventsAttribute) {
            if (trimmedLine === caseIdAttribute) {
              caseIdIndex = attributesCounter;
            } else if (trimmedLine === conceptNameAttribute) {
              conceptNameIndex = attributesCounter;
            } else if (trimmedLine === eventIdAttribute) {
              eventIdIndex = attributesCounter;
            } else if (trimmedLine === followsAttribute) {
              followsIndex = attributesCounter;
            }
            attributesCounter++;
            break;
          } else if (trimmedLine === eventsAttribute) {
            currentParsingState = 'events';
            break;
          } else {
            errors.add(`The log contains invalid parts`);
            this.toastr.error(
              `The log contains invalid parts. '${trimmedLine}' is not a valid attribute`,
              `Unable to parse log`
            );
            return [];
          }
        case 'events':
          if (trimmedLine !== eventsAttribute) {
            const match = this.logEventRegex.exec(trimmedLine);
            if (!match) {
              break;
            }

            const caseId = Number(match[caseIdIndex]);
            const conceptName = match[conceptNameIndex];
            const eventId = match[eventIdIndex];

            const isPartialOrder =
              followsIndex !== -1 &&
              match[followsIndex].includes('[') &&
              match[followsIndex].includes(']');
            const follows =
              followsIndex === -1
                ? []
                : match[followsIndex]
                  .replace('[', '')
                  .replace(']', '')
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => !!s);

            if (currentCaseId !== caseId) {
              if (currentPartialOrder) {
                determineInitialAndFinalEvents(currentPartialOrder);
                returnList.push(currentPartialOrder);
              }

              lastCaseId = undefined;
              currentCaseId = caseId;
              currentPartialOrder = {
                arcs: [],
                events: [],
              };
            }

            const id = addEventItem(
              currentPartialOrder,
              generateEventItem(eventId ?? conceptName, conceptName)
            );
            if (lastCaseId || isPartialOrder) {
              if (isPartialOrder) {
                follows.forEach((follow) => {
                  this.addArcToPartialOrder(currentPartialOrder, {
                    target: id,
                    source: follow,
                    weight: 1,
                    breakpoints: [],
                  });
                });
              } else if (lastCaseId) {
                this.addArcToPartialOrder(currentPartialOrder, {
                  target: id,
                  source: lastCaseId,
                  weight: 1,
                  breakpoints: [],
                });
              }
            }
            lastCaseId = id;
            break;
          } else {
            errors.add(`Unable to parse log`);
            this.toastr.error(`Unable to parse log`, 'Error');
            return [];
          }
      }
    }
    if (currentPartialOrder) {
      determineInitialAndFinalEvents(currentPartialOrder);
      returnList.push(currentPartialOrder);
    }

    if (returnList.length === 0 && errors.size === 0) {
      errors.add(`No parsable traces where found`);
      this.toastr.error(
        `No parsable traces where found in the log`,
        'No traces found'
      );
    }
    return returnList;
  }

  ModelListValues: ModelList[] = [];
  j = 0;
  parsePetriNet(content: string, errors: Set<string>): PetriNet | null {
    const contentLines = content.split('\n');
    const petriNet: PetriNet = {
      transitions: [],
      arcs: [],
      places: [],
    };

    let currentParsingState: ParsingStates = 'initial';
    this.toastr.toasts.forEach((t) => {
      this.toastr.remove(t.toastId);
    });

    for (const line of contentLines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '') {
        continue;
      }

      switch (currentParsingState) {
        case 'initial':
          if (trimmedLine === netTypeKey) {
            currentParsingState = 'type';
            break;
          } else {
            errors.add(
              `The type of the file with the net has to be '` + netTypeKey + `'`
            );
            this.toastr.error(
              `The type has to be '` + netTypeKey + `'`,
              `Unable to parse file`
            );
            return null;
          }
        case 'type':
          if (trimmedLine === transitionsAttribute) {
            currentParsingState = 'transitions';
            break;
          } else if (trimmedLine === arcsAttribute) {
            currentParsingState = 'arcs';
            break;
          } else if (trimmedLine === placesAttribute) {
            currentParsingState = 'places';
            break;
          } else {
            errors.add(`The file contains invalid parts`);
            this.toastr.error(
              `The file contains invalid parts`,
              `Unable to parse file`
            );
            return null;
          }
        case 'transitions':
          if (
            trimmedLine !== arcsAttribute &&
            trimmedLine !== placesAttribute
          ) {
            const transition = this.parseTransition(trimmedLine);

            if (!addTransition(petriNet, transition)) {
              this.toastr.warning(
                `File contains duplicate transitions`,
                `Duplicate transitions are ignored`
              );
            }
            break;
          } else if (trimmedLine === arcsAttribute) {
            currentParsingState = 'arcs';
            break;
          } else if (trimmedLine === placesAttribute) {
            currentParsingState = 'places';
            break;
          } else {
            errors.add(`Unable to parse file`);
            this.toastr.error(`Error`, `Unable to parse file`);
            return null;
          }
        case 'places':
          if (
            trimmedLine !== arcsAttribute &&
            trimmedLine !== transitionsAttribute
          ) {
            const place = this.parsePlace(trimmedLine);

            if (!addPlace(petriNet, place)) { //XXX
              this.toastr.warning(
                `File contains duplicate places`,
                `Duplicate places are ignored`
              );
            }
            break;
          } else if (trimmedLine === arcsAttribute) {
            currentParsingState = 'arcs';
            break;
          } else if (trimmedLine === transitionsAttribute) {
            currentParsingState = 'transitions';
            break;
          } else {
            errors.add(`Unable to parse file`);
            this.toastr.error(`Error`, `Unable to parse file`);
            return null;
          }
        case 'arcs':
          if (
            trimmedLine !== transitionsAttribute &&
            trimmedLine !== placesAttribute
          ) {
            let source: string, target: string, weight: number;
            const breakpoints: Breakpoint[] = [];

            if (this.arcRegex.test(trimmedLine)) {
              const match = this.arcRegex.exec(trimmedLine);

              if (match) {
                source = match[1];
                target = match[2];
                weight = Number(match[3]);
              } else {
                const splitLine = trimmedLine.split(' ');
                source = splitLine[0];
                target = splitLine[1];
                weight = Number(splitLine[2]);
              }

              const elements = getElementsWithArcs(petriNet);
              const parsedSource = elements.find(
                (transition) => transition.id === source
              );
              const parsedTarget = elements.find(
                (transition) => transition.id === target
              );
              if (!parsedSource || !parsedTarget) {
                this.toastr.error(
                  `An arc between ${source} and ${target} is invalid`,
                  `Unable to parse file`
                );
                errors.add(`An arc between ${source} and ${target} is invalid`);
                throw Error(
                  `An arc between ${source} and ${target} is invalid`
                );
              }

              const arc = {
                weight: weight || 1,
                source: source,
                target: target,
                breakpoints: breakpoints,
              };

              let newRow: ModelList = {
                rowId: this.j,
                rowContent: trimmedLine
              };
              this.ModelListValues.push(newRow);
              /* console.log(petriNet); */

              if (!addArc(petriNet, arc)) {
                this.toastr.warning(
                  `File contains duplicate arcs`,
                  `Duplicate arcs are ignored`
                );
              }
            } else {
              this.toastr.warning(
                `Invalid arcs are ignored`,
                `File contains invalid arcs`
              );
            }
            break;
          } else if (trimmedLine === transitionsAttribute) {
            currentParsingState = 'transitions';
            break;
          } else {
            errors.add(`Unable to parse file`);
            this.toastr.error(`Error`, `Unable to parse file`);
            return null;
          }
      }
    }

    if (petriNet.arcs.length === 0 && petriNet.transitions.length === 0) {
      errors.add(`Petri net does not contain events and arcs`);
      this.toastr.error(
        `Petri net does not contain events and arcs`,
        `Unable to parse petri net`
      );
      return null;
    }

    if (!setRefs(petriNet)) {
      this.toastr.warning(
        `File contains arcs for non existing events`,
        `Invalid arcs are ignored`
      );
    }
    /* this.listWrongContinuations(); */
    return petriNet;
  }

  private parseTransition(trimmedLine: string): Transition {
    const match = this.transitionRegex.exec(trimmedLine);
    const id = match ? match[1] : trimmedLine;
    const label = match ? match[2] || match[1] : trimmedLine;

    return {
      id,
      label,
      type: 'transition',
      incomingArcs: [],
      outgoingArcs: [],
    };
  }

  private parsePlace(trimmedLine: string): Place {
    const match = this.placeRegex.exec(trimmedLine);
    const id = match ? match[1] : trimmedLine;
    const tokens = match ? Number(match[2]) : 0;

    return {
      id,
      type: 'place',
      marking: isNaN(tokens) ? 0 : tokens,
      incomingArcs: [],
      outgoingArcs: [],
    };
  }

  private addArcToPartialOrder(
    currentPartialOrder: PartialOrder | undefined,
    arc: Arc
  ): void {
    if (!addArc(currentPartialOrder, arc)) {
      this.toastr.warning(
        `File contains duplicate arcs`,
        `Duplicate arcs are ignored`
      );
    } else if (currentPartialOrder) {
      const source = currentPartialOrder!.events.find(
        (event) => event.id === arc.source
      );
      const target = currentPartialOrder.events.find(
        (event) => event.id === arc.target
      );
      if (source && target) {
        concatEvents(source, target);
      }
    }
  }


  LogListValues: LogList[] = [];
  i = 0;
  // Get the log file
  parseEventLog(content: string, errors: Set<string>): PartialOrder[] {
    // Split the file on each row
    const contentLines = content.split('\n');
    // Start counting the rows
    this.i = this.i++;

    let currentParsingState: LogParsingStates = 'initial';

    let caseIdIndex = 0;
    let conceptNameIndex = 1;
    let eventIdIndex = -1;
    let followsIndex = -1;
    let attributesCounter = 1;

    let currentCaseId: number | undefined;

    const returnList: PartialOrder[] = [];
    let currentPartialOrder: PartialOrder | undefined;
    let lastCaseId: string | undefined;

    // For each line in the array
    for (const line of contentLines) {
      // Remove whitspaces
      const trimmedLine = line.trim();
      if (trimmedLine === '') {
        continue;
      }

      // Check whether it is a title row or not
      // Check the type of the file  
      switch (currentParsingState) {
        case 'initial':
          if (trimmedLine === logTypeKey) {
            currentParsingState = 'type';
          } else {
            errors.add(
              `The type of the file with the log has to be '` + logTypeKey + `'`
            );
            this.toastr.error(
              `The type has to be '` + logTypeKey + `'`,
              `Unable to parse file`
            );
            return [];
          }
          break;
        case 'type':
          if (trimmedLine === attributesAttribute) {
            currentParsingState = 'attributes';
            break;
          } else {
            errors.add(`The log contains invalid parts`);
            this.toastr.error(
              `The log contains invalid parts. '${trimmedLine}' is not a valid attribute`,
              `Unable to parse log`
            );
            return [];
          }
        case 'attributes':
          if (trimmedLine !== eventsAttribute) {
            if (trimmedLine === caseIdAttribute) {
              caseIdIndex = attributesCounter;
            } else if (trimmedLine === conceptNameAttribute) {
              conceptNameIndex = attributesCounter;
            } else if (trimmedLine === eventIdAttribute) {
              eventIdIndex = attributesCounter;
            } else if (trimmedLine === followsAttribute) {
              followsIndex = attributesCounter;
            }
            attributesCounter++;
            break;
          } else if (trimmedLine === eventsAttribute) {
            currentParsingState = 'events';
            break;
          } else {
            errors.add(`The log contains invalid parts`);
            this.toastr.error(
              `The log contains invalid parts. '${trimmedLine}' is not a valid attribute`,
              `Unable to parse log`
            );
            return [];
          }
        case 'events':
          if (trimmedLine !== eventsAttribute) {
            const match = this.logEventRegex.exec(trimmedLine);
            if (!match) {
              break;
            }

            const caseId = Number(match[caseIdIndex]);
            const conceptName = match[conceptNameIndex];
            const eventId = match[eventIdIndex];

            let newRow: LogList = {
              rowId: this.i,
              rowContent: trimmedLine,
              caseId: caseId,
              name: conceptName,
            };
            this.LogListValues.push(newRow);
            console.log(this.LogListValues);

            const isPartialOrder =
              followsIndex !== -1 &&
              match[followsIndex].includes('[') &&
              match[followsIndex].includes(']');
            const follows =
              followsIndex === -1
                ? []
                : match[followsIndex]
                  .replace('[', '')
                  .replace(']', '')
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => !!s);

            if (currentCaseId !== caseId) {
              if (currentPartialOrder) {
                determineInitialAndFinalEvents(currentPartialOrder);
                returnList.push(currentPartialOrder);
              }

              lastCaseId = undefined;
              currentCaseId = caseId;
              currentPartialOrder = {
                arcs: [],
                events: [],
              };
            }

            const id = addEventItem(
              currentPartialOrder,
              generateEventItem(eventId ?? conceptName, conceptName)
            );
            if (lastCaseId || isPartialOrder) {
              if (isPartialOrder) {
                follows.forEach((follow) => {
                  this.addArcToPartialOrder(currentPartialOrder, {
                    target: id,
                    source: follow,
                    weight: 1,
                    breakpoints: [],
                  });
                });
              } else if (lastCaseId) {
                this.addArcToPartialOrder(currentPartialOrder, {
                  target: id,
                  source: lastCaseId,
                  weight: 1,
                  breakpoints: [],
                });
              }
            }
            lastCaseId = id;
            break;
          } else {
            errors.add(`Unable to parse log`);
            this.toastr.error(`Unable to parse log`, 'Error');
            return [];
          }
      }
    }
    if (currentPartialOrder) {
      determineInitialAndFinalEvents(currentPartialOrder);
      returnList.push(currentPartialOrder);
    }

    if (returnList.length === 0 && errors.size === 0) {
      errors.add(`No parsable traces where found`);
      this.toastr.error(
        `No parsable traces where found in the log`,
        'No traces found'
      );
    }
    /* this.listWrongContinuations(); */
    return returnList;
  }


  caseList: CaseList[] = [];
  arcList: ArcList[] = [];
  arcList2: ArcList[] = [];
  allUniqueTransitions: string[] = [];
  allUniquePrefix: string[] = [];
  continuations: string[] = [];
  startVariable: any;
  endVariable: any;
  maxLoopNumber: any;
  public wrongContinuations: string[] = [];
  listWrongContinuations() {
    console.log("Start");
    console.log("Parsed Log: " + this.LogListValues);
    for (var i2 = 0; i2 < this.LogListValues.length; i2++) {
      const newEntry = this.caseList.find(item => item.caseId === this.LogListValues[i2].caseId);
      if (newEntry) {
        newEntry.sequence += this.LogListValues[i2].name;
        console.log(newEntry.sequence);
      } else {
        this.caseList.push({ caseId: this.LogListValues[i2].caseId, sequence: this.LogListValues[i2].name });
      }
    }
    console.log("List with Cases: " + this.caseList);
    this.caseList.forEach((object, index) => {
      console.log(`Object ${index + 1}:`, object);
    });

    for (var i3 = 0; i3 < this.caseList.length; i3++) {
      let caseSplitted = this.caseList[i3].sequence.split('');
      console.log("Transitions of Case " + (i3 + 1) + ": " + caseSplitted);
      let caseUniqueTransitions = Array.from(new Set(caseSplitted));
      console.log("Unique transitions of Case " + (i3 + 1) + ": " + caseUniqueTransitions);
      this.allUniqueTransitions = this.allUniqueTransitions.concat(caseUniqueTransitions);
      this.allUniqueTransitions = Array.from(new Set(this.allUniqueTransitions));
      console.log("Overall unique transitions: " + this.allUniqueTransitions);

      let lastValue = "";
      let prefix = "";
      for (var i4 = 0; i4 < caseSplitted.length; i4++) {
        if (i4 == 0) {
          prefix = caseSplitted[i4];
        } else {
          prefix = lastValue + caseSplitted[i4];
        }
        lastValue = prefix;
        console.log(prefix);
        this.allUniquePrefix.push(prefix);
      }
      this.allUniquePrefix = Array.from(new Set(this.allUniquePrefix));
      console.log("Eindeutige Prefixliste: " + this.allUniquePrefix);

      for (var i7 = 0; i7 < (this.allUniquePrefix.length * this.allUniqueTransitions.length); i7++) {
        /*         for (var i5 = 0; i5 < this.allUniquePrefix.length; i5++) {
                  for (var i6 = 0; i6 < this.allUniqueTransitions.length; i6++) { */
        const i5 = Math.floor(i7 / this.allUniqueTransitions.length);
        const i6 = i7 % this.allUniqueTransitions.length;
        this.continuations[i7] = this.allUniquePrefix[i5].concat(this.allUniqueTransitions[i6]);
        /*           }
                } */
      }
      this.continuations = this.continuations.concat(this.allUniquePrefix);
      this.continuations = Array.from(new Set(this.continuations));
      console.log(this.continuations);
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
    console.log("Loopanzahl: " + this.maxLoopNumber);


    // Example petri net
    /*     .type pn
        .transitions
        a a
        b b
        c c
        .places
        p0 1
        p1 0
        .arcs
        p0 a
        a p1
        b p1
        p1 b
        p1 c */

    // List of arcs in petri net
    console.log("Start with petri net");
    console.log("Parsed Model: " + this.ModelListValues);
    for (var i2 = 0; i2 < this.ModelListValues.length; i2++) {
      const newEntry = this.arcList.find(item => item.arc === this.ModelListValues[i2].rowContent);
      if (newEntry) {
        newEntry.arc += this.ModelListValues[i2].rowContent;
        console.log(newEntry.arc);
      } else {
        this.arcList.push({ arc: this.ModelListValues[i2].rowContent });
      }
    }
    console.log("List with arcs: " + this.arcList);
    this.arcList.forEach((object, index) => {
      console.log(`Object ${index + 1}:`, object);
    });

    // convert arcs to same sequences
    //p0 a -> a
    //p1 b -> b
    //p1 c -> c
    //=> a,b,c

    this.arcList2 = [];
    let highestNumberWithP = 0;

    for (var i3 = 0; i3 < this.arcList.length; i3++) {
      let arcSplitted = this.arcList[i3].arc.split(' ');
      console.log(arcSplitted[0]);
      console.log(arcSplitted[1]);

      // if the arc contains p0 then remove the arc
      /* if (arcSplitted[0] == "p0") {
        this.arcList2.splice(i3);
      } */

      if (arcSplitted[0] == "p0") {
        let newRow: ArcList = {
          arc: arcSplitted[1],
        };
        this.arcList2.push(newRow);
        console.log(newRow);
        // Identify start variable
        this.startVariable = arcSplitted[1];
      }

      // Identify end variable
      if (arcSplitted[0].includes("p") || arcSplitted[1].includes("p")) {
        let numberString = this.arcList[i3].arc.split("p")[1];
        numberString = numberString.split(" ")[0];
        console.log(numberString);
        const number = parseInt(numberString, 10);
        if (!isNaN(number) && number > highestNumberWithP) {
          highestNumberWithP = number;
        }
      }

      // if the arc contains a starting p then check whether there is an ending arc with the same p, then remove the found arc and replace the p with the transitions of the found arc
      /* if (arcSplitted[0].includes("p")) {
        this.arcList = this.arcList.filter(element => {
          const arcSearchSplitted = element.arc.split(' ');
          if (arcSearchSplitted[1].includes(arcSplitted[0])) {
            let newRow: ArcList = {
              arc: arcSplitted[1] + arcSearchSplitted[0],
            };
            this.arcList2.push(newRow);
            console.log(newRow);
            // return false;
            return true;
          } else {
            return true;
          }
        });
      } else */ if (arcSplitted[1].includes("p")) {
        this.arcList = this.arcList.filter(element => {
          const arcSearchSplitted = element.arc.split(' ');
          if (arcSearchSplitted[0].includes(arcSplitted[1])) {
            let newRow: ArcList = {
              arc: arcSplitted[0] + arcSearchSplitted[1],
            };
            this.arcList2.push(newRow);
            console.log(newRow);
            //return false;
            return true;
          } else {
            return true;
          }
        });
      }

      this.arcList2.forEach((object, index) => {
        console.log(`Object ${index + 1}:`, object);
      });

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

    console.log("Startvariable: " + this.startVariable);
    console.log("Endvariable: " + this.endVariable);

    // Build further strings based on the connected letters
    // Example: a, ab, ac, bb, bc, abc, abbc, abbbc, abbbbc
    function generateCombinations(entries: ArcList[], startVariable: string, endVariable: string, maxBb: number = 10): string[] {
      // Filter out entries consisting of a single letter
      const filteredEntries = entries.filter(entry => entry.arc.length > 1);

      // Check if any entry contains 'bb'
      /* const bbInEntries = filteredEntries.some(entry => entry.arc.includes('bb')); */
      const regex = /(.)\1+/;
      const bbInEntries = filteredEntries.some(entry => regex.test(entry.arc));

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
      if (bbInEntries) {
        for (const combination of combinationsWithoutBs) {
          let newCombinations: string[] = [combination];
          while ((newCombinations[0].match(/b/g) || []).length < maxBb) {
            const newEntries: string[] = [];
            for (const newCombination of newCombinations) {
              const bIndex = newCombination.indexOf('b');
              const firstPart = newCombination.slice(0, bIndex + 1);
              const secondPart = newCombination.slice(bIndex + 1);
              newEntries.push(firstPart + 'b' + secondPart);
              const newCombinationCandidate = firstPart + secondPart;
              if (!newEntries.includes(newCombinationCandidate)) {
                newEntries.push(newCombinationCandidate);
              }
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


    // Generate combinations with a default maximum of 3 'bb's
    const generatedCombinations = generateCombinations(this.arcList2, this.startVariable, this.endVariable, this.maxLoopNumber);

    // Output the generated combinations
    console.log("Generated Combinations:", generatedCombinations);

    //Identify loop
    //b p1 -> b

    // Compare the lists
    // generatedCombinations minus event log this.caseList.sequence = wrong continuations
    const sequences = this.caseList.map(obj => obj.sequence);
    this.wrongContinuations = generatedCombinations.filter(obj => !sequences.includes(obj));
    console.log("Wrong continuations: " + this.wrongContinuations);
    console.log("Possible continuations based on the log: " + this.continuations);

    // Dann reparierbar und nicht reparierbar bestimmen. via if b < b-eventlog, dann nicht reparierbar und wenn b > min und max aus event log, dann auch nicht, aber über max schon
    const repairableContinuations: string[] = [];
    const notRepairableContinuations: string[] = [];

    console.log("Wrong continuations (repairable): " + repairableContinuations);
    console.log("Wrong continuations (not repairable): " + notRepairableContinuations);

    // Dann Anzeigen von Lösungen

    return this.wrongContinuations;
  }
}
