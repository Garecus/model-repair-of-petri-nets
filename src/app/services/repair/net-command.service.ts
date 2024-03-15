import { Injectable } from '@angular/core';
import { first, map, Observable, of, tap } from 'rxjs';

import { AutoRepair } from '../../algorithms/regions/parse-solutions.fn';
import { PetriNet } from '../../classes/diagram/petri-net';
import { Place } from '../../classes/diagram/place';
import { DisplayService } from '../display.service';
import { generateTextFromNet } from '../parser/net-to-text.func';
import {
  arcsAttribute,
  attributesAttribute,
  caseIdAttribute,
  conceptNameAttribute,
  eventsAttribute,
  logTypeKey,
  netTypeKey,
  placesAttribute,
  transitionsAttribute,
} from '../parser/parsing-constants';
import { UploadService } from '../upload/upload.service';
import { PartialOrder } from 'src/app/classes/diagram/partial-order';
import { CheckWrongContinuations } from 'src/app/algorithms/check-wrong-continuations/check-wrong-continuations';

@Injectable({
  providedIn: 'root',
})
export class NetCommandService {
  undoQueue: string[] = [];
  redoQueue: string[] = [];

  constructor(
    private uploadService: UploadService,
    private displayService: DisplayService
  ) { }

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
          this.uploadService.setUploadText(newNet);
        }
      })
    );
  }

  repairNet(placeId: string, solution: AutoRepair): Observable<string | null> {
    if (!placeId) {
      return of(null);
    }

    if (placeId == "p_new") {
      placeId = "p1"; //XXX
    }

    return this.displayService.getPetriNet$().pipe(
      first(),
      map((petriNet) => {
        const placeIndex = petriNet.places.findIndex((p) => p.id === placeId);
        if (placeIndex === -1) {
          return null;
        }

        this.undoQueue.push(generateTextFromNet(petriNet));
        return generateTextForNewNet(placeIndex, petriNet, solution);
      }),
      tap((newNet) => {
        if (newNet) {
          this.uploadService.setUploadText(newNet);
        }
      })
    );
  }

  repairSpecification(placeId: string, solution: AutoRepair): Observable<string | null> {
    console.log("repairSpecification");
    if (!placeId) {
      return of(null);
    }

    if (placeId == "p_new") {
      placeId = "p1"; //XXX
    }

    return this.displayService.getPartialOrders$().pipe(
      first(),
      map((specification) => {
        if (specification != null) {
          return generateTraceForLog(specification, solution);
        }
        return "";
      }),
      tap((newSpecification) => {
        if (newSpecification) {
          this.uploadService.setUploadLog(newSpecification);
        }
      })
    );
  }

  undo(): void {
    const net = this.undoQueue.pop();
    if (!net) {
      return;
    }

    this.uploadService
      .getNetUpload$()
      .pipe(first())
      .subscribe((currentUpload) => {
        this.redoQueue.push(currentUpload);
        this.uploadService.setUploadText(net);
      });
  }

  redo(): void {
    const net = this.redoQueue.pop();
    if (!net) {
      return;
    }

    this.uploadService
      .getNetUpload$()
      .pipe(first())
      .subscribe((currentUpload) => {
        this.undoQueue.push(currentUpload);
        this.uploadService.setUploadText(net);
      });
  }
}

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
    if (index !== placeIndex) {
      newText += `${place.id} ${place.marking}\n`;
    } else {
      newText += `${generatePlaceForSolution(
        place.id,
        place.marking,
        solution
      )}\n`;
    }
  });

  if (solution.type === 'add-place') {
    petriNet.places.push(petriNet.places[petriNet.places.length - 1]); //XXX
    petriNet.places[petriNet.places.length - 1].id = "p" + petriNet.places.length + "_new";
    /*     console.log("HERE");
        console.log(petriNet.places[petriNet.places.length - 1]); */
    petriNet.places[petriNet.places.length - 1].marking = 0;
    petriNet.places[petriNet.places.length - 1].issueStatus = undefined;
    placeIndex = +petriNet.places.length - 1;
    /*     petriNet.places[petriNet.places.length - 1].incomingArcs = [
          {
            "weight": 1,
            "source": "a",
            "target": "p1",
            "breakpoints": []
          }
        ];
        petriNet.places[petriNet.places.length - 1].outgoingArcs = [
          {
            "weight": 1,
            "source": "p1",
            "target": "b",
            "breakpoints": []
          },
          {
            "weight": 1,
            "source": "p1",
            "target": "c",
            "breakpoints": []
          }
        ]; */

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
  /* let wrongContinuationNotRepairable = "abbc"; */
  if (solution.wrongContinuationNotRepairable != undefined) {
    wrongContinuationSplitted = solution.wrongContinuationNotRepairable.split('');
    for (let i = 0; i < wrongContinuationSplitted.length; i++) {
      newText += `${specification.length + 1} ${wrongContinuationSplitted[i]} \n`;
    }
  }
  console.log(specification);
  console.log(newText);
  return newText;
}

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
