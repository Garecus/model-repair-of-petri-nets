import { Injectable } from '@angular/core';
import { GLPK } from 'glpk.js';
import { combineLatest, from, map, Observable, of, switchMap, tap } from 'rxjs';

import { PartialOrder, wrongContinuation } from '../../classes/diagram/partial-order';
import { PetriNet } from '../../classes/diagram/petri-net';
import {
  ParsableSolution,
  ParsableSolutionsPerType,
  PlaceSolution,
  PrecisionSolution,
} from '../../services/repair/repair.model';
import { RepairService } from '../../services/repair/repair.service';
import { IlpSolver, SolutionGeneratorType } from './ilp-solver/ilp-solver';
import {
  ProblemSolution,
  VariableName,
  VariableType,
} from './ilp-solver/solver-classes';
import { AddPlaceAutoRepair, AutoRepairForSinglePlace, parseSolution } from './parse-solutions.fn';
import { removeDuplicatePlaces } from './remove-duplicate-places.fn';

const createGlpk: Promise<() => Promise<GLPK>> = import('glpk.js').then(
  (glpk) => (glpk as any).default
);

@Injectable({
  providedIn: 'root',
})
export class PetriNetSolutionService {
  private glpk$ = from(createGlpk.then((create) => create()));

  constructor(private repairService: RepairService) { }

  computeSolutions(
    partialOrders: any[], /* PartialOrder[] */ //XXX
    petriNet: PetriNet,
    invalidPlaces: { [key: string]: number }
  ): Observable<PlaceSolution[]> {
    return this.glpk$.pipe(
      switchMap((glpk) => {
        const invalidPlaceList: SolutionGeneratorType[] = Object.keys(
          invalidPlaces
        ).map((place) => ({ type: 'repair', placeId: place }));

        const allNetLabels = new Set<string>(
          petriNet.transitions.map((t) => t.label)
        );
        const missingTransitions: { [key: string]: number } = {};
        const allEvents = partialOrders.flatMap((po) => po.events);

        for (const event of allEvents) {
          if (allNetLabels.has(event.label)) {
            continue;
          }

          if (missingTransitions[event.label] === undefined) {
            missingTransitions[event.label] = 0;
          }
          missingTransitions[event.label]++;
        }

        const potentialValidPlaces = petriNet.places.filter(
          (place) =>
            place.marking > 0 &&
            !invalidPlaceList.find(
              (repairType) =>
                repairType.type === 'repair' && repairType.placeId === place.id
            )
        );
        for (const potentialValidPlace of potentialValidPlaces) {
          invalidPlaceList.push({
            type: 'warning',
            placeId: potentialValidPlace.id,
          });
        }

        invalidPlaceList.push(
          ...(Object.keys(missingTransitions).map((label) => ({
            type: 'transition',
            newTransition: label,
          })) as SolutionGeneratorType[])
        );
        if (invalidPlaceList.length === 0) {
          return of([]);
        }

        const idToTransitionLabelMap = petriNet.transitions.reduce(
          (acc, transition) => {
            if (!acc[transition.id]) {
              acc[transition.id] = transition.label;
            }
            return acc;
          },
          {} as { [key: string]: string }
        );

        const solver = new IlpSolver(
          glpk,
          partialOrders,
          petriNet,
          idToTransitionLabelMap
        );

        return combineLatest(
          invalidPlaceList.map((place) =>
            // Go to ilp-solver.ts
            solver.computeSolutions(place).pipe(
              map((solutions) => {
                console.log(invalidPlaceList); //ZZZ
                const existingPlace =
                  place.type === 'repair' || place.type === 'warning' || place.type === 'possibility'
                    ? petriNet.places.find((p) => p.id === place.placeId)
                    : undefined;

                if (place.type === 'warning') {
                  const highestMarkingSolution: {
                    regionSize: number;
                    marking: number;
                  } = solutions.reduce(
                    (acc: { regionSize: number; marking: number }, item) => {
                      const itemMax = Math.max(
                        ...item.solutions.map(
                          (solution) => solution[VariableName.INITIAL_MARKING]
                        )
                      );
                      if (acc == null || itemMax > acc.regionSize) {
                        return {
                          regionSize: item.regionSize,
                          marking: itemMax,
                        };
                      }
                      return acc;
                    },
                    null as any
                  );
                  if (highestMarkingSolution.marking < existingPlace!.marking) {
                    return {
                      type: 'warning',
                      place: place.placeId,
                      reduceTokensTo: highestMarkingSolution.marking,
                      tooManyTokens:
                        existingPlace!.marking - highestMarkingSolution.marking,
                      regionSize: highestMarkingSolution.regionSize,
                    };
                  }
                  return undefined;
                }

                const parsedSolutions = parseSolution(
                  handleSolutions(solutions, solver),
                  existingPlace,
                  idToTransitionLabelMap,
                  [],
                  { "": 0 },
                  0
                );

                const newTokens = parsedSolutions.find(
                  (solution) => solution.type === 'marking'
                ) as AutoRepairForSinglePlace;
                const missingTokens =
                  existingPlace && newTokens?.newMarking
                    ? newTokens.newMarking - existingPlace.marking
                    : undefined;

                switch (place.type) {
                  case 'repair':
                    return {
                      type: 'error',
                      place: place.placeId,
                      solutions: parsedSolutions,
                      missingTokens,
                      invalidTraceCount: invalidPlaces[place.placeId],
                    } as PlaceSolution;
                  case 'transition':
                    return {
                      type: 'newTransition',
                      missingTransition: place.newTransition,
                      solutions: parsedSolutions,
                      invalidTraceCount:
                        missingTransitions[place.newTransition],
                    } as PlaceSolution;
                  case 'possibility':
                    return {
                      type: 'possibility',
                      place: place.placeId,
                      solutions: parsedSolutions,
                      missingTokens,
                      invalidTraceCount: 0,
                    } as PrecisionSolution;
                }
              })
            )
          )
        );
      }),
      map(
        (solutions) =>
          solutions.filter((solution) => !!solution) as PlaceSolution[]
      ),
      tap((solutions) =>
        this.repairService.saveNewSolutions(solutions, partialOrders.length)
      )
    );

  }

  computePrecisionSolutions(
    partialOrders: any[], /* PartialOrder[] */ //XXX
    petriNet: PetriNet,
    invalidPlaces: { [key: string]: number },
    invalidTransitions: { [key: string]: number },
    wrongContinuations: wrongContinuation[]
  ): Observable<PlaceSolution[]> {
    console.log("Compute precision with invalid places and transitions: ");
    console.log(invalidPlaces);
    console.log(invalidTransitions);

    return this.glpk$.pipe(
      switchMap((glpk) => {
        let invalidPlaceList: SolutionGeneratorType[] = Object.keys(
          invalidPlaces
        ).map((place) => ({ type: 'possibility', placeId: place }));

        const invalidTransitionList: SolutionGeneratorType[] = Object.keys(
          invalidTransitions
        ).map((transition) => ({ type: 'possibility', placeId: transition }));

        const allNetLabels = new Set<string>(
          petriNet.transitions.map((t) => t.label)
        );
        const missingTransitions: { [key: string]: number } = {};
        const allEvents = partialOrders.flatMap((po) => po.events);

        for (const event of allEvents) {
          if (allNetLabels.has(event.label)) {
            continue;
          }

          if (missingTransitions[event.label] === undefined) {
            missingTransitions[event.label] = 0;
          }
          missingTransitions[event.label]++;
        }

        /* const potentialValidPlaces = petriNet.places.filter(
          (place) =>
            place.marking > 0 &&
            !invalidPlaceList.find(
              (repairType) =>
                repairType.type === 'possibility' && repairType.placeId === place.id
            )
        );
        for (const potentialValidPlace of potentialValidPlaces) {
          invalidPlaceList.push({
            type: 'warning',
            placeId: potentialValidPlace.id,
          });
        }

        invalidPlaceList.push(
          ...(Object.keys(missingTransitions).map((label) => ({
            type: 'transition',
            newTransition: label,
          })) as SolutionGeneratorType[])
        );
        
        if (invalidPlaceList.length === 0) {
          return of([]);
        } */

        const idToTransitionLabelMap = petriNet.transitions.reduce(
          (acc, transition) => {
            if (!acc[transition.id]) {
              acc[transition.id] = transition.label;
            }
            return acc;
          },
          {} as { [key: string]: string }
        );

        const solver = new IlpSolver(
          glpk,
          partialOrders,
          petriNet,
          idToTransitionLabelMap
        );

        invalidPlaceList.forEach((object, index) => {
          console.log(`Invalid place ${index + 1}:`, object);
        });

        invalidTransitionList.forEach((object, index) => {
          console.log(`Invalid transition ${index + 1}:`, object);
        });

        /* invalidPlaceList[0].type="possibility"; */

        return combineLatest(
          invalidTransitionList.map((place) =>
            solver.computePrecisionSolutions(place, wrongContinuations).pipe( //XXX Rename the function with the same name
              map((solutions) => {
                /* const existingPlace =
                  place.type === 'warning' || place.type === 'possibility'
                    ? petriNet.places.find((p) => p.id === place.placeId)
                    : undefined; */

                const existingPlace =
                  place.type === 'warning' || place.type === 'possibility'
                    ? petriNet.places.find((p) => p.id === "p1")//place.placeId)//"p1") //XXX
                    : undefined;

                if (place.type === 'warning') {
                  const highestMarkingSolution: {
                    regionSize: number;
                    marking: number;
                  } = solutions.reduce(
                    (acc: { regionSize: number; marking: number }, item) => {
                      const itemMax = Math.max(
                        ...item.solutions.map(
                          (solution) => solution[VariableName.INITIAL_MARKING]
                        )
                      );
                      if (acc == null || itemMax > acc.regionSize) {
                        return {
                          regionSize: item.regionSize,
                          marking: itemMax,
                        };
                      }
                      return acc;
                    },
                    null as any
                  );
                  /* if (highestMarkingSolution && highestMarkingSolution.marking !== null) { //XXX


                    if (highestMarkingSolution.marking < existingPlace!.marking) {
                      return {
                        type: 'warning',
                        place: place.placeId,
                        reduceTokensTo: highestMarkingSolution.marking,
                        tooManyTokens:
                          existingPlace!.marking - highestMarkingSolution.marking,
                        regionSize: highestMarkingSolution.regionSize,
                      };
                    }
                  } */
                  return undefined;
                }

                console.log(solutions);
                console.log("PLACE");
                console.log(place);
                console.log(place);
                let z = 0;
                if (place.type == "possibility") {
                  z = wrongContinuations.findIndex(variable => variable.firstInvalidTransition.includes(place.placeId)); //ZZZ
                }
                const parsedSolutions = parseSolution(
                  handleSolutions(solutions, solver),
                  existingPlace,
                  idToTransitionLabelMap,
                  wrongContinuations,
                  invalidTransitions,
                  z
                );//ZZZ
                console.log("Parsed solutions: ");
                console.log(parsedSolutions);

                const newTokens = parsedSolutions.find(
                  (solution) => solution.type === 'marking'
                ) as AutoRepairForSinglePlace;
                const missingTokens =
                  existingPlace && newTokens?.newMarking
                    ? newTokens.newMarking - existingPlace.marking
                    : undefined;

                switch (place.type) {
                  case 'repair':
                    /* let testvalue =  {
                      type: 'error',
                      place: place.placeId,
                      solutions: parsedSolutions,
                      missingTokens,
                      invalidTraceCount: invalidPlaces[place.placeId],
                    } as PlaceSolution;
                    console.log(testvalue); */
                    return {
                      type: 'error',
                      place: place.placeId,
                      solutions: parsedSolutions,
                      missingTokens,
                      invalidTraceCount: invalidPlaces[place.placeId],
                    } as PlaceSolution;
                  case 'transition':
                    return {
                      type: 'newTransition',
                      missingTransition: place.newTransition,
                      solutions: parsedSolutions,
                      invalidTraceCount:
                        missingTransitions[place.newTransition],
                    } as PlaceSolution;
                  case 'possibility':
                    /* let testvalue = {
                      type: 'possibility',
                      place: place.placeId,
                      solutions: parsedSolutions,
                      missingTokens,
                      invalidTraceCount: invalidPlaces[place.placeId],
                    } as PlaceSolution;
                    console.log(testvalue); */
                    return {
                      type: 'possibility',
                      place: place.placeId,
                      solutions: parsedSolutions,
                      missingTokens: missingTokens,
                      invalidTraceCount: 0,
                      wrongContinuations: wrongContinuations,
                      newTransition: place.placeId //wrongContinuations[z] ? wrongContinuations[z].wrongContinuation.charAt(wrongContinuations[z].wrongContinuation.length - 1) : "" //XXX Possibility to change this to solutions.wrongContinuation within a for loop
                    } as unknown as PlaceSolution;
                }
              })
            )
          )
        );
      }),
      map(
        (solutions) =>
          solutions.filter((solution) => !!solution) as PlaceSolution[]
      ),
      tap((solutions) =>
        this.repairService.saveNewSolutions(solutions, partialOrders.length)
      )
    );

    /* petriNet.transitions[1].issueStatus = 'possibility'; */
    /* let array = [{
      type: 'possibility',
      solutions: [
        {
            "type": "modify-place",
            "incoming": [
                {
                    "transitionLabel": "a",
                    "weight": 1
                },
                {
                    "transitionLabel": "b",
                    "weight": 1
                }
            ],
            "outgoing": [
                {
                    "transitionLabel": "b",
                    "weight": 1
                },
                {
                    "transitionLabel": "c",
                    "weight": 1
                }
            ],
            "regionSize": 6,
            "repairType": "changeIncoming"
        },
        {
            "type": "replace-place",
            "repairType": "multiplePlaces",
            "regionSize": 6,
            "places": [
                {
                    "incoming": [
                        {
                            "transitionLabel": "a",
                            "weight": 1
                        },
                        {
                            "transitionLabel": "b",
                            "weight": 1
                        }
                    ],
                    "outgoing": [
                        {
                            "transitionLabel": "b",
                            "weight": 1
                        },
                        {
                            "transitionLabel": "c",
                            "weight": 1
                        }
                    ]
                },
                {
                    "incoming": [
                        {
                            "transitionLabel": "a",
                            "weight": 1
                        }
                    ],
                    "outgoing": [
                        {
                            "transitionLabel": "c",
                            "weight": 1
                        }
                    ]
                }
            ]
        },
        {
            "type": "marking",
            "newMarking": 3,
            "regionSize": 25,
            "repairType": "changeMarking"
        }
    ],
      wrongContinuations: "string",
      transition: "string",
      missingPlace: "string",

      place: "p1",
      invalidTraceCount: 2,
      missingTokens: 3,
      regionSize: 1,
      tooManyTokens: 1,
      reduceTokensTo: 1,
      missingTransition: "string",
    }] as PrecisionSolution[];
    return of(array); */

  }
}

export function handleSolutions(
  solutions: ProblemSolution[],
  solver: IlpSolver
): ParsableSolutionsPerType[] {
  const solutionsWithMaybeDuplicates: ParsableSolutionsPerType[] =
    solutions.map((solution) => ({
      type: solution.type,
      solutionParts: solution.solutions
        .map((singleSolution) =>
          Object.entries(singleSolution)
            .filter(
              ([variable, value]) =>
                value != 0 &&
                solver.getInverseVariableMapping(variable) !== null
            )
            .map(([variable, value]) => {
              const decoded = solver.getInverseVariableMapping(variable)!;

              let parsableSolution: ParsableSolution;
              switch (decoded.type) {
                case VariableType.INITIAL_MARKING:
                  parsableSolution = {
                    type: 'increase-marking',
                    newMarking: value,
                  };
                  break;
                case VariableType.INCOMING_TRANSITION_WEIGHT:
                  parsableSolution = {
                    type: 'incoming-arc',
                    incoming: decoded.label,
                    marking: value,
                  };
                  break;
                case VariableType.OUTGOING_TRANSITION_WEIGHT:
                  parsableSolution = {
                    type: 'outgoing-arc',
                    outgoing: decoded.label,
                    marking: value,
                  };
              }

              return parsableSolution;
            })
        )
        .filter((solution) => solution.length > 0),
      regionSize: solution.regionSize,
    }));

  return removeDuplicatePlaces(solutionsWithMaybeDuplicates).filter(
    (value, index) => {
      const stringifiedValue = JSON.stringify(value.solutionParts);
      return (
        index ===
        solutionsWithMaybeDuplicates.findIndex(
          (obj) => JSON.stringify(obj.solutionParts) === stringifiedValue
        )
      );
    }
  );
}
