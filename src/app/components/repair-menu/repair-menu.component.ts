import { OverlayRef } from '@angular/cdk/overlay';
import { Component, EventEmitter, OnInit, ViewEncapsulation } from '@angular/core';

import { SolutionType } from '../../algorithms/regions/ilp-solver/solver-classes';
import { AutoRepair, AutoRepairWithSolutionType } from '../../algorithms/regions/parse-solutions.fn';
import { NetCommandService } from '../../services/repair/net-command.service';
import { PlaceSolution, PrecisionSolution } from '../../services/repair/repair.model';
import { RepairService } from 'src/app/services/repair/repair.service';
import { DomSanitizer } from '@angular/platform-browser'
import { PipeTransform, Pipe } from "@angular/core";
type LabelWithTooltip = {
  label: string;
};

// Need to display the icons in the innerHtml in a different size and color
// This does not work good: https://stackoverflow.com/questions/39628007/angular2-innerhtml-binding-remove-style-attribute/39630507#39630507
// This works, but could cause security issues: https://stackoverflow.com/questions/44210786/style-not-working-for-innerhtml-in-angular
@Pipe({ name: 'pipeHTML' })
export class HTMLPipe implements PipeTransform {
  constructor(private sanitized: DomSanitizer) { }
  transform(value: string) {
    return this.sanitized.bypassSecurityTrustHtml(value);
  }
}

@Component({
  selector: 'app-repair-menu',
  templateUrl: './repair-menu.component.html',
  styleUrls: ['./repair-menu.component.scss'],
})

export class RepairMenuComponent implements OnInit {
  placeSolution!: PlaceSolution;
  partialOrderCount!: number;
  shownTextsForSolutions: { text: LabelWithTooltip; solution: AutoRepair }[] = [];
  overlayRef?: OverlayRef;
  infoHeader = '';
  applySolution = new EventEmitter<void>();

  solutionType = "";

  constructor(private netCommandService: NetCommandService, private repairService: RepairService) { }


  /**
   * On page initialization: Show the user the RepairMenu.FirstLine and .SecondLine
   * @returns the solutions and their descriptions
   */
  ngOnInit(): void {
    this.repairService.triggeredBuildContent.subscribe((solutionType: string) => {
      console.log("Show repair menu with solution type: " + solutionType);
      this.solutionType = solutionType;
    });

    // [precision model repair]
    /* if (this.solutionType == "precision") { */
    /* if (this.transitionSolution) {
    this.infoHeader = `The transition has ${this.transitionSolution.wrongContinuations.length} possible wrong ${this.transitionSolution.wrongContinuations.length === 1 ? 'continuation' : 'continuations'}.`;
    this.shownTextsForSolutions = this.generateSolutionToDisplay(
      this.transitionSolution.solutions,
      true
    );
    console.log(this.shownTextsForSolutions);
    } */
    /*  } */ /* else if (this.solutionType == "fitness") { */
    // Fitness
    if (this.placeSolution.type === 'warning') {
      this.infoHeader = `The place has ${this.placeSolution.tooManyTokens} too many tokens`;
      this.shownTextsForSolutions = [
        {
          text: {
            label: `<b>Change marking to ${this.placeSolution.reduceTokensTo
              }</b><br/>${getSubLabel(this.placeSolution)}`,
          },
          solution: {
            type: 'marking',
            newMarking: this.placeSolution.reduceTokensTo,
          },
        },
      ];
      return;
    }

    const percentage = Intl.NumberFormat('default', {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
      .format(this.placeSolution.invalidTraceCount / this.partialOrderCount)
      .replace(' ', '');
    if (this.placeSolution.type === 'newTransition') {
      this.infoHeader = `The transition ${this.placeSolution.missingTransition} is missing for ${this.placeSolution.invalidTraceCount} (${percentage}) traces.`;
      this.shownTextsForSolutions = this.generateSolutionToDisplay(
        this.placeSolution.solutions,
        true
      );
      return;
    }
    if (this.placeSolution.type != 'possibility' && this.placeSolution.type != 'implicit') {
      this.infoHeader = `The place cannot fire for ${this.placeSolution.invalidTraceCount} (${percentage}) traces.<br/>`;
    }

    if (this.placeSolution.missingTokens) {
      this.infoHeader += `The place has ${this.placeSolution.missingTokens
        } missing ${this.placeSolution.missingTokens === 1 ? 'token' : 'tokens'
        }.<br/>`;
    }

    if (this.placeSolution.type === 'possibility') {
      let relatedWrongContinuationsCount = 0;
      if (this.placeSolution.wrongContinuations) {
        for (let i = 0; i < this.placeSolution.wrongContinuations.length; i++) {
          if (this.placeSolution.wrongContinuations[i].firstInvalidTransition == this.placeSolution.newTransition) {
            relatedWrongContinuationsCount = relatedWrongContinuationsCount + 1;
          }
        }
      }
      this.infoHeader = `The transition has ${relatedWrongContinuationsCount} possible wrong ${relatedWrongContinuationsCount === 1 ? 'continuation' : 'continuations'}. </br> `;
      this.shownTextsForSolutions = this.generateSolutionToDisplay(
        this.placeSolution.solutions,
        true
      );
    }

    if (this.placeSolution.type === 'implicit') {
      this.infoHeader = `The place is an implicit place. </br> `;
      this.shownTextsForSolutions = this.generateSolutionToDisplay(
        this.placeSolution.solutions,
        true
      );
    }

    const solutions = this.placeSolution.solutions;
    if (!solutions) {
      console.error('No solution found!');
    } else {
      this.shownTextsForSolutions = this.generateSolutionToDisplay(solutions);
    }
    /* } */
    if (this.placeSolution.type === 'possibility') {
      this.infoHeader += `Choose one of ${this.placeSolution.solutions.length} solutions to repair the transition:`;
    } else if (this.placeSolution.type === 'implicit') {
      this.infoHeader += `Choose one of ${this.placeSolution.solutions.length} solutions to repair the place:`;
    } else {
      this.infoHeader += 'Choose a solution to repair the place:';
    }
  }

  /**
   * Apply the selected solution to the petri net (and if needed to the log)
   * @param solution single solution out of the process
   */
  useSolution(solution: AutoRepair): void {
    this.applySolution.next();
    if (this.placeSolution.type === 'newTransition') {
      this.netCommandService
        .repairNetForNewTransition(
          this.placeSolution.missingTransition,
          solution
        )
        .subscribe(() => this.overlayRef?.dispose());
    } else if (this.placeSolution.type === 'possibility' && solution.type == "add-trace") { // [precision model repair]
      this.netCommandService
        .repairSpecification(this.placeSolution.place, solution)
        .subscribe(() => this.overlayRef?.dispose());
    } else if (this.placeSolution.type === 'possibility' && solution.type == "add-place") { // [precision model repair]
      this.netCommandService
        .repairNet(this.placeSolution.place, solution)
        .subscribe(() => this.overlayRef?.dispose());
    } else if (this.placeSolution.type === 'implicit' && solution.type == "remove-place") { // [precision model repair]
      this.netCommandService
        .repairNet(this.placeSolution.place, solution)
        .subscribe(() => this.overlayRef?.dispose());
    } else {
      this.netCommandService
        .repairNet(this.placeSolution.place, solution)
        .subscribe(() => this.overlayRef?.dispose());
    }
  }

  /**
   * This will generate inside the repair menu popup the solution list including the solution descriptions
   * @param solutions of the process
   * @param newTransition to identify a different location to display it
   * @returns the solutions text and the solution in the background to apply it by user interaction
   */
  private generateSolutionToDisplay(
    solutions: AutoRepairWithSolutionType[],
    newTransition = false
  ): { text: LabelWithTooltip; solution: AutoRepair }[] {
    return solutions.map((solution) => ({
      text: generateTextForAutoRepair(solution, newTransition),
      solution,
    }));
  }
}

/**
 * Display the solution text (RepairMenu.SolutionList.Record.FirstLine)
 * @param solution of the process
 * @param newTransition special solution that is displayed differently
 * @returns the description of RepairMenu.SolutionList.Record.FirstLine
 */
function generateTextForAutoRepair(
  solution: AutoRepairWithSolutionType,
  newTransition: boolean
): LabelWithTooltip {
  const baseText = generateBaseText(solution, newTransition);
  if (solution.type === 'replace-place') {
    return {
      label: `${baseText}${getSubLabel(solution)}`,
    };
  }
  if (solution.type === 'marking') {
    return {
      label: `${baseText}${getSubLabel(solution)}`,
    };
  }
  if (solution.type === 'add-place') {
    return {
      label: `${baseText}${getSubLabel2(solution)}`,
    };
  }
  if (solution.type === 'add-trace') {
    return {
      label: `${baseText}${getSubLabel3(solution)}`,
    };
  }
  if (solution.type === 'remove-place') {
    return {
      label: `${baseText}${getSubLabel4(solution)}`,
    };
  }
  return {
    label: `${baseText}${getSubLabel(solution)}`,
  };
}

/**
 * Convert the solution types of the ilp-solver into solution text, if no condition in generateBaseText will be applied (RepairMenu.SolutionList.Record.FirstLine)
 */
const solutionTypeToText: { [key in SolutionType]: string } = {
  changeMarking: 'Add tokens',
  changeIncoming: 'Add ingoing tokens',
  multiplePlaces: 'Split place',
  addPlace: 'Repair wrong continuation',
  addTrace: 'Add wrong continuation to specification',
  removePlace: 'Remove implicit place',
};

/**
 * Generate the solution text (RepairMenu.SolutionList.Record.FirstLine)
 * @param solution of the process
 * @param newTransition special solution that is displayed differently
 * @returns the description of RepairMenu.SolutionList.Record.FirstLine
 */
function generateBaseText(
  solution: AutoRepairWithSolutionType,
  newTransition: boolean
): string {
  let text = solutionTypeToText[solution.repairType];
  if (solution.type === 'marking') {
    text = 'Add tokens';
  }

  if (newTransition) {
    if (solution.type === 'modify-place') {
      text = `Add minimal region`;
    }
    if (solution.type === 'replace-place') {
      text = `Add minimal region`;
    }
  }

  if (solution.type === 'add-place') {
    text = '<div style="font-size: 18px;">🦮</div> Repair ' + /* '<b>' + */ solution.relatedWrongContinuation?.wrongContinuation + ''/* + '</b>' */;
    return `${text}`;
  }

  if (solution.type === 'add-trace') {
    if (solution.relatedWrongContinuation?.type == "not repairable") {
      text = '<div style="color: green; font-size: 25px;">&#129092;&#xfe0e;</div>';
    } else {
      text = '<div style="color: rgb(240, 230, 42); font-size: 25px;">&#129092;&#xfe0e;</div>';
    }
    text += ' Add ' + /* '<b>' + */ solution.relatedWrongContinuation?.wrongContinuation /* + '</b>' */;
    return `${text}`;
  }

  if (solution.type === 'remove-place') {
    text = '<div style="font-size: 20px;">&#9747;&#xfe0e;</div> Remove implicit place';
    return `${text}`;
  }

  return `<b>${text}</b></br>`;
}

/**
 * Generate the text of the (RepairMenu.SolutionList.Record.SecondLine)
 * @param solution 
 * @returns solution description of RepairMenu.SolutionList.Record.SecondLine
 */
function getSubLabel(solution: { regionSize: number }): string {
  return `<span>Region size: ${solution.regionSize}</span>`;
}

/**
 * Generate the text of the RepairMenu.SolutionList.Record.SecondLine
 * @param solution 
 * @returns solution description of RepairMenu.SolutionList.Record.SecondLine
 */
function getSubLabel2(solution: { regionSize: number }): string {
  return ` by adding a place to the net. Region size: ${solution.regionSize}`;
}

/**
 * Generate the text of the RepairMenu.SolutionList.Record.SecondLine
 * @param solution 
 * @returns solution description of RepairMenu.SolutionList.Record.SecondLine
 */
function getSubLabel3(solution: { regionSize: number }): string {
  return ` to the specification.`;
}

/**
 * Generate the text of the RepairMenu.SolutionList.Record.SecondLine
 * @param solution 
 * @returns solution description of RepairMenu.SolutionList.Record.SecondLine
 */
function getSubLabel4(solution: { regionSize: number }): string {
  return ` from the net.`;
}