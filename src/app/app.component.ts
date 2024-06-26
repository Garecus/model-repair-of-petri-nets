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
  hasPartialOrders = false;
  isCurrentNetEmpty$: Observable<boolean>;
  partialOrderCount$: Observable<{ count: number }>;
  resetPositioningSubject: Subject<void> = new Subject<void>();
  shouldShowSuggestions$: Observable<string>;
  solutionType = "unknown";
  isToggled = false;
  isToggledPrecision = false;
  shouldShowPrecisionSuggestions$: Observable<string>;

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
    this.shouldShowPrecisionSuggestions$ = displayService.getShouldShowPrecisionSuggestions();

    window.onresize = () => this.resetSvgPositioning();
  }

  /**
   * On init: Get the count of the partial orders
   */
  ngOnInit(): void {
    this.partialOrderCount$
      .pipe(first())
      .subscribe((count) => this.startEditing(count.count));
  }

  /**
   * Reset the svg position (displayed process model)
   */
  resetSvgPositioning(): void {
    this.resetPositioningSubject.next();
  }

  /**
   * Open the file selector to upload files (log and net)
   */
  openFileSelector(type: StructureType | undefined): void {
    this.uploadService.openFileSelector(type);
  }

  /**
   * On file drop, upload the files (log and net)
   * @param event on file drop by the user
   * @param type to identify whether its a log or net
   */
  dropFiles(event: DragEvent, type: StructureType | undefined): void {
    if (event.dataTransfer?.files) {
      this.uploadService.uploadFiles(event.dataTransfer.files, type);
    }
  }

  mainStyle: string = "defaultMain";
  introductionStyle: string = "defaultIntroduction";
  /**
   * Edit the view, if files are uploaded
   * @param count 
   */
  startEditing(count: number): void {
    if (count > 0) {
      this.hasPartialOrders = true;
      setTimeout(() => this.resetSvgPositioning());

      // Adjust the view (e.g expand canvas and reduce introduction text)
      this.mainStyle = 'changedMainStyle';
      this.introductionStyle = 'changedIntroductionStyle';
    }
  }

  /**
   * Handle the fitness toggle button and the influence on the precision toggle button
   * @param event that is the click on the button by the user
   */
  changeToggle(event: MatSlideToggleChange): void {
    if (event.checked && this.isToggled) {
      this.displayService.setShouldShowSuggestions("fitness");
    } else {
      this.displayService.setShouldShowSuggestions("");
    }

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

  /**
   * Handle the precision toggle button and the influence on the fitness toggle button
   * @param event that is the click on the button by the user
   */
  changeTogglePrecision(event: MatSlideToggleChange): void {

    if (event.checked && this.isToggledPrecision) {
      this.displayService.setShouldShowSuggestions("precision");
    } else {
      this.displayService.setShouldShowSuggestions("");
    }

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
