import { Injectable } from '@angular/core';
import { first, map, Observable, of, tap } from 'rxjs';

import { AutoRepair } from '../../algorithms/regions/parse-solutions.fn';
import { PetriNet } from '../../classes/diagram/petri-net';
import { Place } from '../../classes/diagram/place';
import { DisplayService } from '../display.service';
import { generateTextFromNet } from '../parser/net-to-text.func';
import { arcsAttribute, attributesAttribute, caseIdAttribute, conceptNameAttribute, eventsAttribute, logTypeKey, netTypeKey, placesAttribute, transitionsAttribute } from '../parser/parsing-constants';
import { UploadService } from '../upload/upload.service';
import { PartialOrder } from 'src/app/classes/diagram/partial-order';

@Injectable({
  providedIn: 'root',
})
export class NetCommandService {
  undoQueue: string[] = [];
  redoQueue: string[] = [];
  undoQueueLog: string[] = [];
  redoQueueLog: string[] = [];

  constructor(
    private uploadService: UploadService,
    private displayService: DisplayService
  ) { }

  /**
   * Repair the net by adding missing transitions [fitness model repair]
   * @param missingTransition to add to the process model and net
   * @param solution where it was evaluated
   * @returns a new net in string format
   */
  repairNetForNewTransition(
    missingTransition: string,
    solution: AutoRepair
  ): Observable<string | null> {
    if (!missingTransition) {
      return of(null);
    }

    return this.displayService.getPetriNet$().pipe(
      first(),
      map((petriNet) => {
        this.undoQueue.push(generateTextFromNet(petriNet));
        return generateTextForNetWithTransition(
          missingTransition,
          petriNet,
          solution
        );
      }),
      tap((newNet) => {
        if (newNet) {
          this.uploadService.setUploadNet(newNet);
        }
      })
    );
  }

  /**
   * Repair the net, if places have to be repaired [fitness model repair]
   * @param placeId 
   * @param solution 
   * @returns a new net in string format
   */
  repairNet(placeId: string, solution: AutoRepair): Observable<string | null> {
    if (!placeId) {
      return of(null);
    }

    // Set the invalid place to an existing one to pass the if request 10 lines below
    /* if (placeId && solution.type !== "remove-place") { //placeId == "p_new"
      placeId = "p1"; //invalidPlaces
    } */
    
    return this.displayService.getPetriNet$().pipe(
      first(),
      map((petriNet) => {
        const placeIndex = petriNet.places.findIndex((p) => p.id === placeId);
        /* if (placeIndex === -1) {
          return null;
        } */

        // Store the current net in the undo list
        this.undoQueue.push(generateTextFromNet(petriNet));

        // Store the current log in the undo list
        this.uploadService
          .getLogUpload$()
          .pipe(first())
          .subscribe((currentUpload) => {
            this.undoQueueLog.push(currentUpload);
          });

        return generateTextForNewNet(placeIndex, petriNet, solution);
      }),
      tap((newNet) => {
        if (newNet) {
          this.uploadService.setUploadNet(newNet);
        }
      })
    );
  }

  /**
   * Repair the net if a place has to be added or a trace as to be added to the log [precision model repair]
   * @param placeId 
   * @param solution 
   * @returns a new net in string format
   */
  repairSpecification(placeId: string, solution: AutoRepair): Observable<string | null> {
    if (!placeId) {
      return of(null);
    }

    /* if (placeId == "p_new") {
      placeId = "p1"; //invalidPlaces
    } */

    return this.displayService.getPartialOrders$().pipe(
      first(),
      map((specification) => {
        if (specification != null) {
          // Store the current log in the undo list
          this.undoQueueLog.push(generateLog(specification));
          return generateTraceForLog(specification, solution);
        }
        return "";
      }),
      tap((newSpecification) => {
        if (newSpecification) {
          this.uploadService.setUploadLog(newSpecification);
          // Store the current net in the undo list
          this.uploadService
            .getNetUpload$()
            .pipe(first())
            .subscribe((currentUpload) => {
              this.undoQueue.push(currentUpload);
            });

        }
      })
    );
  }

  /**
   * Action that is performed, if the user uses the button "Undo correction"
   * @returns empty if no log or net available in the undo list
   */
  undo(): void {
    // Get the latest net and store it, then upload the old one
    const net = this.undoQueue.pop();
    if (!net) {
      return;
    }
    this.uploadService
      .getNetUpload$()
      .pipe(first())
      .subscribe((currentUpload) => {
        this.redoQueue.push(currentUpload);
        this.uploadService.setUploadNet(net);
      });

    // Get the latest log and store it, then upload the old one
    const log = this.undoQueueLog.pop();
    if (!log) {
      return;
    }
    this.uploadService
      .getLogUpload$()
      .pipe(first())
      .subscribe((currentUpload) => {
        this.redoQueueLog.push(currentUpload);
        this.uploadService.setUploadLog(log);
      });
  }

  /**
 * Action that is performed, if the user uses the button "Redo correction"
 * @returns empty if no log or net available in the redo list
 */
  redo(): void {
    // Get the current net and store it, then upload the new one
    const net = this.redoQueue.pop();
    if (!net) {
      return;
    }
    this.uploadService
      .getNetUpload$()
      .pipe(first())
      .subscribe((currentUpload) => {
        this.undoQueue.push(currentUpload);
        this.uploadService.setUploadNet(net);
      });

    // Get the current log and store it, then upload the new one
    const log = this.redoQueueLog.pop();
    if (!log) {
      return;
    }
    this.uploadService
      .getLogUpload$()
      .pipe(first())
      .subscribe((currentUpload) => {
        this.undoQueueLog.push(currentUpload);
        this.uploadService.setUploadLog(log);
      });
  }
}

/**
 * Generate a new net based on the solution for new transitions
 * @param newTransition 
 * @param petriNet 
 * @param solution 
 * @returns new net string (displayed in view)
 */
function generateTextForNetWithTransition(
  newTransition: string,
  petriNet: PetriNet,
  solution: AutoRepair
): string {
  let newText = `${netTypeKey}\n${transitionsAttribute}\n`;
  const labelToIdMap = new Map<string, string>();
  petriNet.transitions.forEach((transition) => {
    newText += `${transition.id} ${transition.label}\n`;
    labelToIdMap.set(transition.label, transition.id);
  });

  // Handle completely new transitions
  const requiredTransitions = getRequiredTransitions(solution);
  const transitionsThatDontExist = requiredTransitions.filter(
    (requiredLabel) =>
      !petriNet.transitions.some(
        (transition) => transition.label === requiredLabel
      )
  );
  for (const transitionLabel of transitionsThatDontExist) {
    let id = transitionLabel;
    while (petriNet.transitions.find((t) => t.id === id)) {
      id += '_';
    }
    labelToIdMap.set(transitionLabel, id);
    newText += `${id} ${transitionLabel}\n`;
  }

  newText += `${placesAttribute}\n`;
  petriNet.places.forEach((place) => {
    newText += `${place.id} ${place.marking}\n`;
  });

  let placeId = 'p' + petriNet.places.length;
  while (petriNet.places.find((t) => t.id === placeId)) {
    placeId += '_';
  }
  newText += `${generatePlaceForSolution(placeId, 0, solution)}\n`;

  const arcsToGenerate = generateArcsForSolution(
    placeId,
    petriNet,
    solution,
    labelToIdMap
  );

  newText += `${arcsAttribute}\n`;
  arcsToGenerate.forEach((arc, index) => {
    newText += `${arc.source} ${arc.target}${arc.weight > 1 ? ` ${arc.weight}` : ''
      }`;

    if (index !== arcsToGenerate.length - 1) {
      newText += '\n';
    }
  });

  return newText;
}

/**
 * Generate a new net based on the solution
 * @param placeIndex 
 * @param petriNet 
 * @param solution 
 * @returns new net string (displayed in view)
 */
function generateTextForNewNet(
  placeIndex: number,
  petriNet: PetriNet,
  solution: AutoRepair
): string {
  let newText = `${netTypeKey}\n${transitionsAttribute}\n`;
  petriNet.transitions.forEach((transition) => {
    newText += `${transition.id} ${transition.label}\n`;
  });

  // Handle completely new transitions
  const requiredTransitions = getRequiredTransitions(solution);
  const transitionsThatDontExist = requiredTransitions.filter(
    (requiredLabel) =>
      !petriNet.transitions.some(
        (transition) => transition.label === requiredLabel
      )
  );
  const labelToIdMap = new Map<string, string>();

  for (const transitionLabel of transitionsThatDontExist) {
    let id = transitionLabel;
    while (petriNet.transitions.find((t) => t.id === id)) {
      id += '_';
    }
    labelToIdMap.set(transitionLabel, id);
    newText += `${id} ${transitionLabel}\n`;
  }

  // Get Ids of existing transitions with same label
  for (const requiredTransition of requiredTransitions) {
    const transition = petriNet.transitions.find(
      (t) => t.label === requiredTransition
    );
    if (transition) {
      labelToIdMap.set(requiredTransition, transition.id);
    }
  }

  newText += `${placesAttribute}\n`;
  petriNet.places.forEach((place, index) => {
    // If there is an remove-place solution, then we remove a place
    if (solution.type === 'remove-place' && index === placeIndex) {
      newText += "";
      solution.implicitPlace = place;
    } else {
      if (index !== placeIndex) {
        newText += `${place.id} ${place.marking}\n`;
      } else {
        newText += `${generatePlaceForSolution(
          place.id,
          place.marking,
          solution
        )}\n`;
      }
    }
  });

  // If there is an add-place solution, then we introduce a new place
  if (solution.type === 'add-place') {
    petriNet.places.push(petriNet.places[petriNet.places.length - 1]);
    petriNet.places[petriNet.places.length - 1].id = "p" + (petriNet.places.length - 1) + "_new";
    petriNet.places[petriNet.places.length - 1].marking = 0;
    petriNet.places[petriNet.places.length - 1].issueStatus = undefined;
    placeIndex = +petriNet.places.length - 1;

    newText += `${generatePlaceForSolution(
      petriNet.places[petriNet.places.length - 1].id,
      0,
      solution
    )}\n`;
  }

  const oldPlace: Place = petriNet.places[placeIndex];
  const arcsToGenerate = generateArcsForSolution(
    oldPlace.id,
    petriNet,
    solution,
    labelToIdMap
  );

  newText += `${arcsAttribute}\n`;
  arcsToGenerate.forEach((arc, index) => {
    newText += `${arc.source} ${arc.target}${arc.weight > 1 ? ` ${arc.weight}` : ''
      }`;

    if (index !== arcsToGenerate.length - 1) {
      newText += '\n';
    }
  });
  console.log("New net: ");
  console.log(newText);
  return newText;
}

/**
 * Generate a new trace to add it to the existing log
 * @param specification is the log from the upload service
 * @param solution is solution that will apply this new trace
 * @returns a string of the specification including the new line (new line = wrong continuation of solution)
 */
function generateTraceForLog(
  specification: PartialOrder[],
  solution: AutoRepair,
): string {
  let newText = `${logTypeKey}\n${attributesAttribute}\n${caseIdAttribute}\n${conceptNameAttribute}\n${eventsAttribute}\n`;
  specification.forEach((trace, index) => {
    for (let i = 0; i < trace.events.length; i++) {
      let j = index + 1;
      newText += `${j} ${trace.events[i].label} \n`;
    }
  });
  let wrongContinuationSplitted = [""];
  if (solution.wrongContinuationNotRepairable != undefined) {
    wrongContinuationSplitted = solution.wrongContinuationNotRepairable.split('');
    for (let i = 0; i < wrongContinuationSplitted.length; i++) {
      newText += `${specification.length + 1} ${wrongContinuationSplitted[i]} \n`;
    }
  }
  //console.log(specification);
  //console.log(newText);
  return newText;
}

/**
 * Generate the log
 * @param specification 
 * @returns a string which contains the log in the custom format
 */
function generateLog(
  specification: PartialOrder[]
): string {
  let newText = `${logTypeKey}\n${attributesAttribute}\n${caseIdAttribute}\n${conceptNameAttribute}\n${eventsAttribute}\n`;
  specification.forEach((trace, index) => {
    for (let i = 0; i < trace.events.length; i++) {
      let j = index + 1;
      newText += `${j} ${trace.events[i].label} \n`;
    }
  });
  return newText;
}

/**
 * Get the required transitions
 * @param solution 
 * @returns transitions string list
 */
function getRequiredTransitions(solution: AutoRepair): string[] {
  if (solution.type === 'modify-place') {
    return Array.from(
      new Set([
        ...solution.incoming.map((arc) => arc.transitionLabel),
        ...solution.outgoing.map((arc) => arc.transitionLabel),
      ])
    );
  }

  if (solution.type === 'replace-place') {
    return Array.from(
      new Set(
        solution.places.flatMap((place) => [
          ...place.incoming.map((arc) => arc.transitionLabel),
          ...place.outgoing.map((arc) => arc.transitionLabel),
        ])
      )
    );
  }

  if (solution.type === 'add-place') {
    return Array.from(
      new Set([
        ...solution.incoming.map((arc) => arc.transitionLabel),
        ...solution.outgoing.map((arc) => arc.transitionLabel),
      ])
    );
  }

  return [];
}

/**
 * Generate the place based on the solution
 * @param placeId 
 * @param oldMarking 
 * @param solution 
 * @returns a string place
 */
function generatePlaceForSolution(
  placeId: string,
  oldMarking: number,
  solution: AutoRepair
): string {
  if (solution.type === 'marking') {
    return `${placeId} ${solution.newMarking}`;
  }
  if (solution.type === 'modify-place' && solution.newMarking) {
    return `${placeId} ${solution.newMarking}`;
  }
  if (solution.type === 'add-place' && solution.newMarking) {
    return `${placeId} ${solution.newMarking}`;
  }
  if (solution.type === 'replace-place') {
    let textToReturn = '';
    for (let index = 0; index < solution.places.length; index++) {
      textToReturn += `${placeId}_${index} ${solution.places[index].newMarking ?? 0
        }`;
      if (index < solution.places.length - 1) {
        textToReturn += '\n';
      }
    }
    return textToReturn;
  }

  return `${placeId} ${oldMarking}`;
}

/**
 * Generates the arcs based on the solution
 * @param oldPlaceId 
 * @param petriNet 
 * @param solution 
 * @param labelToIdMap 
 * @returns arcs with arc type
 */
function generateArcsForSolution(
  oldPlaceId: string,
  petriNet: PetriNet,
  solution: AutoRepair,
  labelToIdMap: Map<string, string>
): SimpleArcDefinition[] {
  if (solution.type === 'marking') {
    return petriNet.arcs;
  }

  const filteredArcs: SimpleArcDefinition[] = petriNet.arcs.filter(
    (arc) => arc.target !== oldPlaceId && arc.source !== oldPlaceId
  );
  if (solution.type === 'modify-place') {
    return filteredArcs.concat(
      ...solution.incoming.map((incoming) => ({
        source:
          labelToIdMap.get(incoming.transitionLabel) ||
          incoming.transitionLabel,
        target: oldPlaceId,
        weight: incoming.weight,
      })),
      ...solution.outgoing.map((outgoing) => ({
        source: oldPlaceId,
        target:
          labelToIdMap.get(outgoing.transitionLabel) ||
          outgoing.transitionLabel,
        weight: outgoing.weight,
      }))
    );
  }

  if (solution.type === 'add-place') {
    return filteredArcs.concat(
      ...solution.incoming.map((incoming) => ({
        source:
          labelToIdMap.get(incoming.transitionLabel) ||
          incoming.transitionLabel,
        target: oldPlaceId,
        weight: incoming.weight,
      })),
      ...solution.outgoing.map((outgoing) => ({
        source: oldPlaceId,
        target:
          labelToIdMap.get(outgoing.transitionLabel) ||
          outgoing.transitionLabel,
        weight: outgoing.weight,
      }))
    );
  }

  if (solution.type === 'remove-place') {
    let arcs = petriNet.arcs.filter((arc) => solution.implicitPlace != undefined && arc.source !== solution.implicitPlace.id && arc.target !== solution.implicitPlace.id);
    return arcs;
  }

  if (solution.places) {
    return filteredArcs.concat(
      solution.places.flatMap((place, index) => [
        ...place.incoming.map((incoming) => ({
          source:
            labelToIdMap.get(incoming.transitionLabel) ||
            incoming.transitionLabel,
          target: `${oldPlaceId}_${index}`,
          weight: incoming.weight,
        })),
        ...place.outgoing.map((outgoing) => ({
          source: `${oldPlaceId}_${index}`,
          target:
            labelToIdMap.get(outgoing.transitionLabel) ||
            outgoing.transitionLabel,
          weight: outgoing.weight,
        })),
      ])
    );
  } else {
    console.log("missing places");
    return [];
  }
}

type SimpleArcDefinition = { source: string; target: string; weight: number };
