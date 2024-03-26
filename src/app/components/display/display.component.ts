import { Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import { MatButton } from '@angular/material/button';
import clonedeep from 'lodash.clonedeep';
import { BehaviorSubject, distinctUntilChanged, map, Observable, of, shareReplay, startWith, Subject, switchMap, tap, } from 'rxjs';

import { FirePartialOrder } from '../../algorithms/fire-partial-orders/fire-partial-order';
import { PetriNetSolutionService } from '../../algorithms/regions/petri-net-solution.service';
import { LogList, PartialOrder, wrongContinuation } from '../../classes/diagram/partial-order';
import { PetriNet } from '../../classes/diagram/petri-net';
import { Place } from '../../classes/diagram/place';
import { DisplayService } from '../../services/display.service';
import { LayoutResult, LayoutService, } from '../../services/layout/layout.service';
import { NewTransitionSolution, PlaceSolution, PrecisionSolution, } from '../../services/repair/repair.model';
import { RepairService } from '../../services/repair/repair.service';
import { SvgService } from '../../services/svg/svg.service';
import { CanvasComponent } from '../canvas/canvas.component';
import { ParserService } from 'src/app/services/parser/parser.service';
import { CheckWrongContinuations } from 'src/app/algorithms/check-wrong-continuations/check-wrong-continuations';
import { Transition } from 'src/app/classes/diagram/transition';

@Component({
  selector: 'app-display',
  templateUrl: './display.component.html',
  styleUrls: ['./display.component.scss'],
})
export class DisplayComponent implements OnInit {
  @Input()
  resetSvgPosition?: Observable<void>;

  computingSolutions = false;

  layoutResult$?: Observable<LayoutResult & { renderChanges: boolean }>;
  @ViewChild('canvas') canvas: CanvasComponent | undefined;
  @ViewChild('svg_wrapper') svgWrapper: ElementRef<HTMLElement> | undefined;

  invalidPlaceCount$: Subject<{ count: number } | null>;
  invalidTransitionCount$: Subject<{ count: number } | null>;
  wrongContinuationCount$: Subject<{ count: number } | null>;
  wrongContinuations: wrongContinuation[] = [];
  wrongContinuationsString: string[] = [];
  implicitPlaceCount$: Subject<{ count: number } | null>;

  tracesCount$: Observable<number>;
  transitionSolutions$: Observable<NewTransitionSolution[]>;
  precisionSolutions$: Observable<PrecisionSolution[]>;

  shouldShowSuggestions$: Observable<string>;
  shouldShowPrecisionSuggestions$: Observable<boolean>;
  solutionType = "";
  precisionActive: boolean = false;

  constructor(
    private layoutService: LayoutService,
    private svgService: SvgService,
    private displayService: DisplayService,
    private petriNetRegionsService: PetriNetSolutionService,
    private repairService: RepairService,
    private parserService: ParserService
  ) {
    this.shouldShowSuggestions$ = this.displayService
      .getShouldShowSuggestions()
      .pipe(distinctUntilChanged());

    this.shouldShowPrecisionSuggestions$ = this.displayService
      .getShouldShowPrecisionSuggestions()
      .pipe(distinctUntilChanged());

    this.invalidPlaceCount$ = new BehaviorSubject<{ count: number } | null>(
      null
    );

    this.wrongContinuationCount$ = new BehaviorSubject<{ count: number } | null>(
      null
    );

    this.invalidTransitionCount$ = new BehaviorSubject<{ count: number } | null>(
      null
    );

    this.implicitPlaceCount$ = new BehaviorSubject<{ count: number } | null>(
      null
    );

    this.transitionSolutions$ = repairService
      .getSolutions$()
      .pipe(
        map(
          (solutions) =>
            solutions.filter(
              (s) => s.type === 'newTransition'
            ) as NewTransitionSolution[]
        )
      );

    this.precisionSolutions$ = repairService
      .getPrecisionSolutions$()
      .pipe(
        map(
          (solutions) =>
            solutions.filter(
              (s) => s.type === 'possibility' || s.type === 'implicit'
            ) as PrecisionSolution[]
        )
      );

    this.tracesCount$ = this.displayService.getPartialOrders$().pipe(
      map((partialOrders) => partialOrders?.length ?? 0),
      shareReplay(1)
    );
  }

  /**
   * On init: Check which process should be started based on the switch buttons
   */
  ngOnInit(): void {
    this.displayService.triggeredBuildContent.subscribe((solutionType: string) => {
      this.solutionType = solutionType;
      if (this.solutionType == "precision") {
        this.precisionActive = true;
      } else if (this.solutionType == "fitness") {
        this.precisionActive = false;
      }
      /* this.buildContent(); */
    });

    // Display the content that is up to date right now
    this.layoutResult$ = this.displayService.getPetriNet$().pipe(
      switchMap((net) =>
        this.displayService.getPartialOrders$().pipe(
          startWith([]),
          switchMap((partialOrders: PartialOrder[] | null) =>
            this.shouldShowSuggestions$.pipe(
              switchMap((showSuggestions) => {

                if (showSuggestions == "precision") {
                  this.precisionActive = true;
                } else {
                  this.precisionActive = false;
                }
                if (!showSuggestions || showSuggestions != "precision" && showSuggestions != "fitness") {

                  net.places.forEach((place) => {
                    place.issueStatus = undefined;
                  });
                  this.invalidPlaceCount$.next({
                    count: 0,
                  });
                  this.invalidTransitionCount$.next({
                    count: 0,
                  });
                  this.implicitPlaceCount$.next({
                    count: 0,
                  });
                  this.repairService.saveNewSolutions([], 0);
                  return of({ solutions: [], renderChanges: true });
                }

                if (!partialOrders || partialOrders.length === 0) {
                  this.repairService.saveNewSolutions([], 0);
                  return of({ solutions: [], renderChanges: true });
                }

                this.computingSolutions = true;

                // Identification of invalidPlaces to know where repairs can be performed
                const invalidPlaces: {
                  [key: string]: number;
                } = {};
                for (let index = 0; index < partialOrders.length; index++) {
                  const currentInvalid = this.firePartialOrder(
                    net,
                    partialOrders[index]
                  );

                  currentInvalid.forEach((place) => {
                    if (invalidPlaces[place] === undefined) {
                      invalidPlaces[place] = 0;
                    }
                    invalidPlaces[place]++;
                  });
                }

                const placeIds = Object.keys(invalidPlaces);
                this.invalidPlaceCount$.next({
                  count: placeIds.length,
                });

                const places: Place[] = net.places.filter((place) =>
                  placeIds.includes(place.id)
                );
                net.places.forEach((place) => {
                  place.issueStatus = undefined;
                });
                places.forEach((invalidPlace) => {
                  invalidPlace.issueStatus = 'error';
                });

                // Identification of wrongContinuations to be able to handle them
                /*
                for (let index = 0; index < partialOrders.length; index++) {
                  this.wrongContinuations = this.checkWrongContinuations(net, partialOrders[index], partialOrders);
                }
                */
                this.wrongContinuations = this.checkWrongContinuations(net, partialOrders[0], partialOrders);
                this.wrongContinuationsString = this.wrongContinuations.map(a => a.wrongContinuation);

                this.wrongContinuationCount$.next({
                  count: this.wrongContinuations.length,
                });

                // Identification of transitions that are directly affected by wrongContinuations to work with them
                const invalidTransitions: {
                  [key: string]: number;
                } = {};
                for (let index = 0; index < partialOrders.length; index++) {
                  const currentInvalid = this.identifyTransitionsWithWrongContinuations(
                    net,
                    partialOrders[index], partialOrders, this.wrongContinuations
                  );

                  currentInvalid.forEach((transition) => {
                    if (invalidTransitions[transition] === undefined) {
                      invalidTransitions[transition] = 0;
                    }
                    invalidTransitions[transition]++;
                  });
                }

                const transitionIds = Object.keys(invalidTransitions);
                this.invalidTransitionCount$.next({
                  count: transitionIds.length,
                });

                const transitions: Transition[] = net.transitions.filter((transition) =>
                  transitionIds.includes(transition.id)
                );
                net.transitions.forEach((transition) => {
                  transition.issueStatus = undefined;
                });
                // Here we generate the numbers that where shown next to each "!" in the UI to show the user how many wrong continuations are possible at these transitions
                transitions.forEach((invalidTransition) => {
                  let relatedWrongContinuationsCount = 0;
                  for (let i = 0; i < this.wrongContinuations.length; i++) {
                    if (this.wrongContinuations[i].firstInvalidTransition == invalidTransition.id) {
                      relatedWrongContinuationsCount = relatedWrongContinuationsCount + 1;
                    }
                  }
                  invalidTransition.issueStatus = 'error';
                  invalidTransition.relatedWrongContinuationsCount = relatedWrongContinuationsCount.toString();
                });

                // Identification of implicitPlaces to know where repairs can be performed
                let implicitPlaces: {
                  [key: string]: number;
                } = {};
                for (let index = 0; index < partialOrders.length; index++) {
                  const currentInvalid = this.firePartialOrder(
                    net,
                    partialOrders[index]
                  );

                  implicitPlaces = { //XXX
                    "p1": 1
                  };
                  currentInvalid.forEach((place) => {
                    if (implicitPlaces[place] === undefined) {
                      implicitPlaces[place] = 0;
                    }
                    implicitPlaces[place]++;
                  });
                }

                const placeIds2 = Object.keys(implicitPlaces);
                this.implicitPlaceCount$.next({
                  count: placeIds2.length,
                });

                const places2: Place[] = net.places.filter((place) =>
                  placeIds.includes(place.id)
                );
                net.places.forEach((place) => {
                  place.issueStatus = undefined;
                });
                places2.forEach((implicitPlace) => {
                  implicitPlace.issueStatus = 'implicit';
                });

                if (showSuggestions == "fitness") {
                  net.transitions.forEach((transition) => {
                    transition.issueStatus = undefined;
                  });
                  this.wrongContinuationCount$.next({
                    count: 0,
                  });
                  this.implicitPlaceCount$.next({
                    count: 0,
                  });

                  return this.petriNetRegionsService
                    .computeSolutions(partialOrders, net, invalidPlaces)
                    .pipe(
                      tap(() => (this.computingSolutions = false)),
                      map((solutions) => ({
                        solutions,
                        renderChanges: false,
                      })),
                      startWith({
                        solutions: [] as PlaceSolution[],
                        renderChanges: false,
                      })
                    );
                } else if (showSuggestions == "precision") {
                  net.places.forEach((place) => {
                    place.issueStatus = undefined;
                  });
                  this.invalidPlaceCount$.next({
                    count: 0,
                  });
                  
                  let invalidPlaces = { //XXX
                    "p_new": 1,
                  }

                  //let solutions: any = [];
                  //let newSolution: any;
                  /*  for (let z = 0; z < this.wrongContinuations.length; z++) {
                     return this.petriNetRegionsService
                     //newSolution = this.petriNetRegionsService
                       .computePrecisionSolutions(partialOrders, net, invalidPlaces, invalidTransitions, this.wrongContinuations, z)
                       .pipe(
                         tap(() => (this.computingSolutions = false)
                         ),
                         map((solutions) => ({
                           solutions,
                           renderChanges: false,
                         })
                         ),
                         startWith({
                           solutions: [] as PrecisionSolution[],
                           renderChanges: false,
                         })
                       );
                       //solutions.push(newSolution);
                   }
                   this.computingSolutions = false;
                   return of({ solutions: [], renderChanges: true }); */
                  //console.log(solutions);
                  //solutions = solutions[0];
                  //return of({ solutions, renderChanges: true });
                  return this.petriNetRegionsService
                    .computePrecisionSolutions(partialOrders, net, invalidPlaces, invalidTransitions, this.wrongContinuations, implicitPlaces)
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
                } else {
                  net.transitions.forEach((transition) => {
                    transition.issueStatus = undefined;
                  });
                  this.wrongContinuationCount$.next({
                    count: 0,
                  });
                  net.places.forEach((place) => {
                    place.issueStatus = undefined;
                  });
                  this.invalidPlaceCount$.next({
                    count: 0,
                  });
                  this.implicitPlaceCount$.next({
                    count: 0,
                  });
                  this.repairService.saveNewSolutions([], 0);
                  return of({ solutions: [], renderChanges: true });
                }

              }),
              // Below this part within this method we take care that the solutions and the net are displayed in the updated form to the user
              map(({ solutions, renderChanges }) => {
                for (const place of solutions) {
                  if (place.type === 'newTransition') {
                    continue;
                  }
                  const foundPlace = net.places.find(
                    (p) => p.id === place.place
                  );
                  if (foundPlace) {
                    foundPlace.issueStatus = place.type;
                  }
                }
                return { net, renderChanges };
              })
            )
          ),
          switchMap(({ net, renderChanges }) =>
            (this.resetSvgPosition
              ? this.resetSvgPosition.pipe(
                startWith(undefined),
                map(() => this.layoutService.layout(clonedeep(net)))
              )
              : of(this.layoutService.layout(clonedeep(net)))
            ).pipe(map((result) => ({ ...result, renderChanges })))
          )
        )
      )
    );
  }

  /**
   * Fire the net with the partial orders to get all invalid places
   * @param petriNet 
   * @param partialOrder 
   * @returns list of invalid places
   */
  private firePartialOrder(
    petriNet: PetriNet,
    partialOrder: PartialOrder
  ): string[] {
    //console.log("Fire Partial order");
    return new FirePartialOrder(petriNet, partialOrder).getInvalidPlaces();
  }

  /**
   * Apply the solution to the net after user selected it [fitness model repair]
   * @param solution that should be applied ot the process model
   * @param button the user pressed
   */
  applySolution(solution: NewTransitionSolution, button: MatButton): void {
    const domRect: DOMRect = button._elementRef.nativeElement.getBoundingClientRect();
    this.repairService.showRepairPopoverForSolution(domRect, solution);
  }

  /**
   * Apply the solution to the net after user selected it [precision model repair]
   * @param solution that should be applied ot the process model
   * @param button the user pressed
   */
  applySolutionPrecision(solution: PrecisionSolution, button: MatButton): void {
    const domRect: DOMRect = button._elementRef.nativeElement.getBoundingClientRect();
    this.repairService.showRepairPopoverForSolutionPrecision(domRect, solution);
  }

  /**
   * Check the net and the partial orders to generate all possible wrong continuations
   * @param petriNet 
   * @param partialOrder 
   * @param partialOrders 
   * @returns a list of wrong continuation objects
   */
  private checkWrongContinuations(
    petriNet: PetriNet,
    partialOrder: PartialOrder,
    partialOrders: PartialOrder[]
  ): wrongContinuation[] {
    return new CheckWrongContinuations(petriNet, partialOrder, partialOrders, this.petriNetRegionsService, this.parserService).getWrongContinuations();
  }

  /**
   * Identify the transitions that have wrong continuations related to them
   * @param petriNet 
   * @param partialOrder 
   * @param partialOrders 
   * @param wrongContinuations 
   * @returns a list of invalid transitions
   */
  private identifyTransitionsWithWrongContinuations(
    petriNet: PetriNet,
    partialOrder: PartialOrder,
    partialOrders: PartialOrder[],
    wrongContinuations: wrongContinuation[]
  ): string[] {
    return new CheckWrongContinuations(petriNet, partialOrder, partialOrders, this.petriNetRegionsService, this.parserService).getInvalidTransitions(wrongContinuations);
  }
}
