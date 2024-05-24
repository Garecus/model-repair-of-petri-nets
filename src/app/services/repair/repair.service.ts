import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { EventEmitter, Injectable, Output } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { BehaviorSubject, Observable, Subject, Unsubscribable } from 'rxjs';

import { RepairMenuComponent } from '../../components/repair-menu/repair-menu.component';
import { PlaceSolution, PrecisionSolution } from './repair.model';

@Injectable({
  providedIn: 'root',
})
export class RepairService {
  private currentOpenElement?: string;

  private solutions: PlaceSolution[] = [];
  private precisionSolutions: PrecisionSolution[] = [];
  private partialOrderCount = 0;
  private overlayRef?: OverlayRef;
  private outsideClickSubscription?: Unsubscribable;

  private unsubscribables: Unsubscribable[] = [];
  private solutions$: Subject<PlaceSolution[]> = new BehaviorSubject<
    PlaceSolution[]
  >([]);
  private precisionSolutions$: Subject<PrecisionSolution[]> = new BehaviorSubject<
    PrecisionSolution[]
  >([]);

  constructor(private toastr: ToastrService, private overlay: Overlay) { }

  /**
   * Save the generated solution
   * @param solutions 
   * @param partialOrderCount 
   */
  saveNewSolutions(
    solutions: PlaceSolution[],
    partialOrderCount: number
  ): void {
    this.solutions = solutions;
    this.partialOrderCount = partialOrderCount;
    this.solutions$.next(solutions);
  }

  /**
   * Get the solution of the [fitness model repair]
   * @returns solution
   */
  getSolutions$(): Observable<PlaceSolution[]> {
    return this.solutions$;
  }

  /**
 * Get the solution of the [precision model repair]
 * @returns solution
 */
  getPrecisionSolutions$(): Observable<PrecisionSolution[]> {
    return this.precisionSolutions$;
  }

  /**
   * Show the repair popover (not repair menu) [fitness model repair]
   * @param ref where it should be shown (element)
   * @param solution 
   * @returns the popover itself incl. settings, location
   */
  showRepairPopoverForSolution(ref: DOMRect, solution?: PlaceSolution): void {
    if (!solution) {
      this.toastr.warning(`No solutions found`);
      return;
    }

    if (this.overlayRef) {
      this.overlayRef.dispose();
    }

    this.currentOpenElement =
      solution.type === 'newTransition'
        ? solution.missingTransition
        : solution.place;
    if (this.outsideClickSubscription) {
      this.outsideClickSubscription.unsubscribe();
    }

    this.overlayRef = this.overlay.create();
    const position = this.overlay
      .position()
      .flexibleConnectedTo(ref)
      .withPositions([
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top',
        },
      ]);

    // We create the overlay
    // Then we create a portal to render a component
    const componentPortal = new ComponentPortal(RepairMenuComponent);

    this.overlayRef.addPanelClass('current-overlay');
    this.overlayRef.updatePositionStrategy(position);
    this.overlayRef.updateScrollStrategy(this.overlay.scrollStrategies.noop());

    this.unsubscribables.push(
      (this.outsideClickSubscription = this.overlayRef
        .outsidePointerEvents()
        .subscribe(() => this.clearOverlay()))
    );

    const componentRef = this.overlayRef.attach(componentPortal);
    componentRef.instance.overlayRef = this.overlayRef;
    componentRef.instance.placeSolution = solution;
    componentRef.instance.partialOrderCount = this.partialOrderCount;

    this.unsubscribables.push(
      componentRef.instance.applySolution.subscribe(() => this.clearOverlay())
    );
  }

  /**
   * Show the repair popover (not repair menu) [precision model repair]
   * @param ref where it should be shown (element)
   * @param solution 
   * @returns the popover itself incl. settings, location
   */
  showRepairPopoverForSolutionPrecision(ref: DOMRect, solution?: PlaceSolution): void {
    if (!solution) {
      this.toastr.warning(`No solutions found`);
      return;
    }

    if (this.overlayRef) {
      this.overlayRef.dispose();
    }
    
    if (solution.type != "newTransition") {
    this.currentOpenElement =
      solution.type === 'possibility'
        ? solution.newTransition
        : solution.place;
      }
    if (this.outsideClickSubscription) {
      this.outsideClickSubscription.unsubscribe();
    }

    this.overlayRef = this.overlay.create();
    const position = this.overlay
      .position()
      .flexibleConnectedTo(ref)
      .withPositions([
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top',
        },
      ]);

    // We create the overlay
    //Then we create a portal to render a component
    const componentPortal = new ComponentPortal(RepairMenuComponent);

    this.overlayRef.addPanelClass('current-overlay');
    this.overlayRef.updatePositionStrategy(position);
    this.overlayRef.updateScrollStrategy(this.overlay.scrollStrategies.noop());

    this.unsubscribables.push(
      (this.outsideClickSubscription = this.overlayRef
        .outsidePointerEvents()
        .subscribe(() => this.clearOverlay()))
    );

    const componentRef = this.overlayRef.attach(componentPortal);
    componentRef.instance.overlayRef = this.overlayRef;
    componentRef.instance.placeSolution = solution;
    componentRef.instance.partialOrderCount = this.partialOrderCount;

    this.unsubscribables.push(
      componentRef.instance.applySolution.subscribe(() => this.clearOverlay())
    );
  }

  /**
   * Show the model repair popover [fitness model repair]
   * @param ref reference value
   * @param place show it on the position of the place
   * @returns only if the opened element is not a place
   */
  showRepairPopover(ref: DOMRect, place: string): void {
    if (this.currentOpenElement === place) {
      this.currentOpenElement = undefined;
      this.overlayRef?.dispose();
      return;
    }

    const solutionsForPlace = this.solutions.find(
      (s) => s.type !== 'newTransition' && s.place === place
    );
    this.showRepairPopoverForSolution(ref, solutionsForPlace);
  }

  /**
   * Show the model repair popover [precision model repair]
   * @param ref reference value
   * @param transition show it on the position of the transition
   * @returns only if the opened element is not a transition
   */
  showRepairPopoverPrecision(ref: DOMRect, transition: string): void {
    if (this.currentOpenElement === transition) {
      this.currentOpenElement = undefined;
      this.overlayRef?.dispose();
      return;
    }
    const solutionsForTransition = this.solutions.find(
      (s) => s.type === 'possibility' && s.newTransition === transition
    );
    this.showRepairPopoverForSolutionPrecision(ref, solutionsForTransition);
  }

  /**
   * Clear the repair menu popover again
   */
  private clearOverlay(): void {
    this.currentOpenElement = undefined;
    this.overlayRef?.dispose();
    this.overlayRef = undefined;

    this.unsubscribables.forEach((u) => u.unsubscribe());
    this.unsubscribables = [];
  }

  @Output() triggeredBuildContent = new EventEmitter<string>();
  triggerBuildContent(solutionType: string) {
    this.triggeredBuildContent.emit(solutionType);
  }
}
