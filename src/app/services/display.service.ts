import { EventEmitter, Injectable, Output } from '@angular/core';
import { BehaviorSubject, map, Observable, ReplaySubject, shareReplay, startWith, Subject, } from 'rxjs';

import { Coordinates } from '../classes/diagram/coordinates';
import { ArcList, PartialOrder } from '../classes/diagram/partial-order';
import { isNetEmpty, PetriNet } from '../classes/diagram/petri-net';

@Injectable({
  providedIn: 'root',
})
export class DisplayService {
  private petriNet$: Subject<PetriNet>;
  private currentErrors$: Subject<Set<string>>;
  private partialOrders$: Subject<PartialOrder[] | null>;

  private showSuggestions$ = new BehaviorSubject("false");
  private showPrecisionSuggestions$ = new BehaviorSubject("false");
  private reset$: BehaviorSubject<Coordinates>;

  private sequences$: Subject<ArcList[] | null>;

  constructor() {
    this.petriNet$ = new ReplaySubject<PetriNet>(1);
    this.partialOrders$ = new BehaviorSubject<PartialOrder[] | null>(null);
    this.currentErrors$ = new BehaviorSubject<Set<string>>(new Set());

    this.reset$ = new BehaviorSubject<Coordinates>({ x: 0, y: 0 });

    this.sequences$ = new BehaviorSubject<ArcList[] | null>(null);
  }

  getShouldShowSuggestions(): Observable<string> {
    return this.showSuggestions$.asObservable();
  }

  setShouldShowSuggestions(show: string): void {
    this.showSuggestions$.next(show);
  }

  getCurrentErrors$(): Observable<Set<string>> {
    return this.currentErrors$.asObservable();
  }

  getPetriNet$(): Observable<PetriNet> {
    return this.petriNet$.asObservable();
  }

  isCurrentNetEmpty$(): Observable<boolean> {
    return this.petriNet$.pipe(
      map((run) => isNetEmpty(run)),
      startWith(true),
      shareReplay(1)
    );
  }

  setNewNet(newSource: PetriNet, errors: Set<string>): void {
    this.petriNet$.next(newSource);
    this.currentErrors$.next(errors);
  }

  setPartialOrders(partialOrder: PartialOrder[]): void {
    this.partialOrders$.next(partialOrder);
  }

  getPartialOrders$(): Observable<PartialOrder[] | null> {
    return this.partialOrders$.asObservable();
  }

  // Get the information to know which method should be used [precision model repair]
  getShouldShowPrecisionSuggestions(): Observable<string> {
    return this.showPrecisionSuggestions$.asObservable();
  }

  // Set the information to know which method should be used [precision model repair]
  setShouldShowPrecisionSuggestions(show: string): void {
    this.showSuggestions$.next(show);
  }

  // Transfer the information which method should be used [precision model repair]
  @Output() triggeredBuildContent = new EventEmitter<string>();
  triggerBuildContent(solutionType: string) {
    this.triggeredBuildContent.emit(solutionType);
  }

  // Get sequences of the log [precision model repair]
  getSequences$(): Observable<ArcList[] | null> {
    return this.sequences$.asObservable();
  }

}
