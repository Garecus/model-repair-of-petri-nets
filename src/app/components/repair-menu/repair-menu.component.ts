import { OverlayRef } from '@angular/cdk/overlay';
import { Component, EventEmitter, OnInit } from '@angular/core';

import { SolutionType } from '../../algorithms/regions/ilp-solver/solver-classes';
import { AutoRepair, AutoRepairWithSolutionType } from '../../algorithms/regions/parse-solutions.fn';
import { NetCommandService } from '../../services/repair/net-command.service';
import { PlaceSolution, PrecisionSolution } from '../../services/repair/repair.model';
import { RepairService } from 'src/app/services/repair/repair.service';

type LabelWithTooltip = {
  label: string;
};

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

  // On page initialization: Show the user the RepairMenu.FirstLine and .SecondLine
  ngOnInit(): void {
    this.repairService.triggeredBuildContent.subscribe((solutionType: string) => {
      console.log("Show repair menu with solution type: " + solutionType);
      this.solutionType = solutionType;
    });

    // Precision
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
    if (this.placeSolution.type != 'possibility') {
      this.infoHeader = `The place cannot fire for ${this.placeSolution.invalidTraceCount} (${percentage}) traces.<br/>`;
    }

    if (this.placeSolution.missingTokens) {
      this.infoHeader += `The place has ${this.placeSolution.missingTokens
        } missing ${this.placeSolution.missingTokens === 1 ? 'token' : 'tokens'
        }.<br/>`;
    }

    if (this.placeSolution.type === 'possibility') {
      this.infoHeader = `The transition has ${this.placeSolution.wrongContinuations.length} possible wrong ${this.placeSolution.wrongContinuations.length === 1 ? 'continuation' : 'continuations'}. `;
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
    this.infoHeader += 'Choose a solution to repair the place:';
  }

  // Apply the selected solution to the petri net
  useSolution(solution: AutoRepair): void {
    this.applySolution.next();
    if (this.placeSolution.type === 'newTransition') {
      this.netCommandService
        .repairNetForNewTransition(
          this.placeSolution.missingTransition,
          solution
        )
        .subscribe(() => this.overlayRef?.dispose());
    } else if (this.placeSolution.type === 'possibility') { // Precision
      this.netCommandService
        .repairNet(this.placeSolution.place, solution)
        .subscribe(() => this.overlayRef?.dispose());
    } else {
      this.netCommandService
        .repairNet(this.placeSolution.place, solution)
        .subscribe(() => this.overlayRef?.dispose());
    }
  }

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

// Display the solution text (1. Part to display RepairMenu.SolutionList.Record.FirstLine)
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
      label: `${baseText}${getSubLabel(solution)}`,
    };
  }

  return {
    label: `${baseText}${getSubLabel(solution)}`,
  };
}

// Convert the solution types of the ilp-solver into solution text  (1. Part to display RepairMenu.SolutionList.Record.FirstLine)
const solutionTypeToText: { [key in SolutionType]: string } = {
  changeMarking: 'Add tokens',
  changeIncoming: 'Add ingoing tokens',
  multiplePlaces: 'Split place',
  addPlace: 'Add place',
};

// Generate the text of the RepairMenu.SolutionList.Record.SecondLine
function getSubLabel(solution: { regionSize: number }): string {
  return `<span>Region size: ${solution.regionSize}</span>`;
}

// Generate the solution text (2. Part to display RepairMenu.SolutionList.Record.FirstLine)
function generateBaseText(
  solution: AutoRepairWithSolutionType,
  newTransition: boolean
): string {
  let text = solutionTypeToText[solution.repairType];
  if (solution.type === 'add-place') {
    text = 'Add place';
  }
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

  return `<b>${text}</b></br>`;
}
