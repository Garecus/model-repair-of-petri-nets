import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { first, map, Observable, Subject } from 'rxjs';

import { DisplayService } from './services/display.service';
import { NetCommandService } from './services/repair/net-command.service';

import { StructureType, UploadService } from './services/upload/upload.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  // Variables
  hasPartialOrders = false;
  isCurrentNetEmpty$: Observable<boolean>;
  partialOrderCount$: Observable<{ count: number }>;
  resetPositioningSubject: Subject<void> = new Subject<void>();
  shouldShowSuggestions$: Observable<string>;
  solutionType = "unknown";
  isToggled = false;
  isToggledPrecision = false;

  constructor(
    private displayService: DisplayService,
    private uploadService: UploadService,
    public netCommandService: NetCommandService
  ) {
    this.partialOrderCount$ = displayService
      .getPartialOrders$()
      .pipe(map((pos) => ({ count: pos?.length ?? 0 })));

    this.isCurrentNetEmpty$ = displayService.isCurrentNetEmpty$();

    this.shouldShowSuggestions$ = displayService.getShouldShowSuggestions();

    window.onresize = () => this.resetSvgPositioning();
  }

  //
  ngOnInit(): void {
    this.partialOrderCount$
      .pipe(first())
      .subscribe((count) => this.startEditing(count.count));
  }

  //
  resetSvgPositioning(): void {
    this.resetPositioningSubject.next();
  }

  //
  openFileSelector(type: StructureType | undefined): void {
    this.uploadService.openFileSelector(type);
  }

  //
  dropFiles(event: DragEvent, type: StructureType | undefined): void {
    if (event.dataTransfer?.files) {
      this.uploadService.uploadFiles(event.dataTransfer.files, type);
    }
  }

  mainStyle: string = "defaultMain";
  introductionStyle: string = "defaultIntroduction";
  //
  startEditing(count: number): void {
    if (count > 0) {
      this.hasPartialOrders = true;
      setTimeout(() => this.resetSvgPositioning());

      // Adjust the view (e.g expand canvas and reduce introduction text)
      this.mainStyle = 'changedMainStyle';
      this.introductionStyle = 'changedIntroductionStyle';
    }
  }

  //
  changeToggle(event: MatSlideToggleChange): void {
    if (event.checked && this.isToggled) {
      this.displayService.setShouldShowSuggestions("fitness");
    } else {
      this.displayService.setShouldShowSuggestions("");
    }
    /* this.displayService.setShouldShowSuggestions(event.checked); */

    // Set the other toggle button to false, if it was true ToDo
    if (this.isToggled == true && this.isToggledPrecision == true) {
      this.isToggledPrecision = false;
    }

    // Trigger the correct logic in the display service
    if (this.isToggled == true) {
      this.solutionType = "fitness";
      this.displayService.triggerBuildContent(this.solutionType);
    }
  }

  //
  changeTogglePrecision(event: MatSlideToggleChange): void {

    if (event.checked && this.isToggledPrecision) {
      this.displayService.setShouldShowSuggestions("precision");
    } else {
      this.displayService.setShouldShowSuggestions("");
    }
    /* this.displayService.setShouldShowPrecisionSuggestions(event.checked); */

    // Set the other toggle button to false, if it was true ToDo
    if (this.isToggled == true && this.isToggledPrecision == true) {
      this.isToggled = false;
    }

    // Trigger the correct logic in the display service
    if (this.isToggledPrecision == true) {
      this.solutionType = "precision";
      this.displayService.triggerBuildContent(this.solutionType);
    }
  }
}
