import { Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import { MatButton } from '@angular/material/button';
import clonedeep from 'lodash.clonedeep';
import {
  BehaviorSubject,
  distinctUntilChanged,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { FirePartialOrder } from '../../algorithms/fire-partial-orders/fire-partial-order';
import { PetriNetSolutionService } from '../../algorithms/regions/petri-net-solution.service';
import { LogList, PartialOrder } from '../../classes/diagram/partial-order';
import { PetriNet } from '../../classes/diagram/petri-net';
import { Place } from '../../classes/diagram/place';
import { DisplayService } from '../../services/display.service';
import {
  LayoutResult,
  LayoutService,
} from '../../services/layout/layout.service';
import {
  NewTransitionSolution,
  PlaceSolution,
  TransitionSolution,
} from '../../services/repair/repair.model';
import { RepairService } from '../../services/repair/repair.service';
import { SvgService } from '../../services/svg/svg.service';
import { CanvasComponent } from '../canvas/canvas.component';
import { ParserService } from 'src/app/services/parser/parser.service';
import { CheckWrongContinuations } from 'src/app/algorithms/check-wrong-continuations/check-wrong-continuations';

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
  wrongContinuationCount$: Subject<{ count: number } | null>;
  wrongContinuations: string[] = [];

  tracesCount$: Observable<number>;
  transitionSolutions$: Observable<NewTransitionSolution[]>;
  precisionSolutions$: Observable<TransitionSolution[]>;

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
              (s) => s.type === 'warning'
            ) as TransitionSolution[]
        )
      );

    this.tracesCount$ = this.displayService.getPartialOrders$().pipe(
      map((partialOrders) => partialOrders?.length ?? 0),
      shareReplay(1)
    );
  }

  ngOnInit(): void {
    this.displayService.triggeredBuildContent.subscribe((solutionType: string) => {
      console.log("Display component: " + solutionType);
      this.solutionType = solutionType;
      // Identify which logic should be used
      if (this.solutionType == "precision") {
        this.precisionActive = true;
      } else if (this.solutionType == "fitness") {
        this.precisionActive = false;
      }
      /* this.buildContent(); */
    });

    // Default content
    this.layoutResult$ = this.displayService.getPetriNet$().pipe(
      switchMap((net) =>
        this.displayService.getPartialOrders$().pipe(
          startWith([]),
          switchMap((partialOrders: PartialOrder[] | null) =>
            this.shouldShowSuggestions$.pipe(
              switchMap((showSuggestions) => {
                if (showSuggestions == "precision") {
                  this.precisionActive = true;
                }
                if (!showSuggestions || showSuggestions != "precision" && showSuggestions != "fitness") {
                  
                  net.places.forEach((place) => {
                    place.issueStatus = undefined;
                  });
                  this.invalidPlaceCount$.next({
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

                /*
                for (let index = 0; index < partialOrders.length; index++) {
                  this.wrongContinuations = this.checkWrongContinuations(net, partialOrders[index], partialOrders);
                }
                */
                this.wrongContinuations = this.checkWrongContinuations(net, partialOrders[0], partialOrders);

                this.wrongContinuationCount$.next({
                  count: this.wrongContinuations.length,
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

                if (showSuggestions == "fitness") {
                  net.transitions.forEach((transition) => {
                    transition.issueStatus = undefined;
                  });
                  this.wrongContinuationCount$.next({
                    count: 0,
                  });

                  return this.petriNetRegionsService
                    .computeSolutions(partialOrders, net, invalidPlaces,this.wrongContinuations, "fitness")
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
                } else if (showSuggestions == "precision"){
                  net.places.forEach((place) => {
                    place.issueStatus = undefined;
                  });
                  this.invalidPlaceCount$.next({
                    count: 0,
                  });

                  return this.petriNetRegionsService
                    .computePrecisionSolutions(partialOrders, net, invalidPlaces, this.wrongContinuations, "precision")
                    .pipe(
                      tap(() => (this.computingSolutions = false)),
                      map((solutions) => ({
                        solutions,
                        renderChanges: false,
                      })),
                      startWith({
                        solutions: [] as TransitionSolution[],
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
                  this.repairService.saveNewSolutions([], 0);
                  return of({ solutions: [], renderChanges: true });
                }
              
              }),
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

  private firePartialOrder(
    petriNet: PetriNet,
    partialOrder: PartialOrder
  ): string[] {
    return new FirePartialOrder(petriNet, partialOrder).getInvalidPlaces();
  }

  applySolution(solution: NewTransitionSolution, button: MatButton): void {
    const domRect: DOMRect = button._elementRef.nativeElement.getBoundingClientRect();
    this.repairService.showRepairPopoverForSolution(domRect, solution);
  }

  applySolutionPrecision(solution: TransitionSolution, button: MatButton): void {
    const domRect: DOMRect = button._elementRef.nativeElement.getBoundingClientRect();
    this.repairService.showRepairPopoverForSolutionPrecision(domRect, solution);
  }

  private checkWrongContinuations(
    petriNet: PetriNet,
    partialOrder: PartialOrder,
    partialOrders: PartialOrder[]
  ): string[] {
    return new CheckWrongContinuations(petriNet, partialOrder, partialOrders).getInvalidTransitions();
  }
}
