import { Injectable, OnDestroy } from '@angular/core';
import { first, Subject } from 'rxjs';

import { PetriNet } from '../../classes/diagram/petri-net';
import { DownloadFormat } from '../../components/download/download.const';
import { DisplayService } from '../display.service';
import { generateTextFromNet } from '../parser/net-to-text.func';
import { convertPetriNetToPnml } from './run-to-pnml/petri-net-to-pnml.service';
import { PartialOrder } from 'src/app/classes/diagram/partial-order';
import { generateTextFromLog } from './run-to-log/log-to-txt.service';

@Injectable({
  providedIn: 'root',
})
export class DownloadService implements OnDestroy {
  private _download$: Subject<string>;

  constructor(private displayService: DisplayService) {
    this._download$ = new Subject<string>();
  }

  ngOnDestroy(): void {
    this._download$.complete();
  }

  /**
   * Start the process to download the petri net
   * @param name as file name
   * @param fileFormat as file format
   */
  downloadNet(name: string, fileFormat: DownloadFormat): void {
    this.displayService
      .getPetriNet$()
      .pipe(first())
      .subscribe((run) => {
        const fileEnding = getFileEndingForFormat(fileFormat);
        const fileName = name
          ? `${name}-net.${fileEnding}`
          : `${Date.now()}-net.${fileEnding}`;

        this.downloadNetRun(fileName, fileFormat, run);
      });
  }

  /**
   * Start the process to download the log
   * @param name as file name
   * @param fileFormat as file format
   */
  downloadLog(name: string, fileFormat: DownloadFormat): void {
    this.displayService
      .getPartialOrders$()
      .pipe(first())
      .subscribe((run) => {
        const fileEnding = getFileEndingForFormatLog(fileFormat);
        const fileName = name
          ? `${name}-log.${fileEnding}`
          : `${Date.now()}-log.${fileEnding}`;

        if (run != null) {
          this.downloadLogRun(fileName, fileFormat, run);
        }
      });
  }

  /**
   * Perform the real download of the petri net
   * @param name as file name
   * @param fileFormat as file format
   * @param petriNet as petri net object
   */
  private downloadNetRun(
    name: string,
    fileFormat: DownloadFormat,
    petriNet: PetriNet
  ): void {
    const fileContent =
      fileFormat === 'pn'
        ? generateTextFromNet(petriNet)
        : convertPetriNetToPnml(name, petriNet);

    const downloadLink: HTMLAnchorElement = document.createElement('a');
    downloadLink.download = name;
    downloadLink.href =
      'data:text/plain;charset=utf-16,' + encodeURIComponent(fileContent);
    downloadLink.click();
    downloadLink.remove();
  }

  /**
   * Perform the real download of the log
   * @param name as file name
   * @param fileFormat as file format
   * @param petriNet as petri net object
   */
  private downloadLogRun(
    name: string,
    fileFormatLog: DownloadFormat,
    partialOrder: PartialOrder[]
  ): void {
    const fileContent =
      fileFormatLog === 'txt'
        ? generateTextFromLog(partialOrder) // JSON.stringify(partialOrder) is not enough here, because it has to be converted from objects to lines of text to get the custom format
        : JSON.stringify(partialOrder); // Anyway if the other solution does not work, then export it at least

    const downloadLink: HTMLAnchorElement = document.createElement('a');
    downloadLink.download = name;
    downloadLink.href =
      'data:text/plain;charset=utf-16,' + encodeURIComponent(fileContent);
    downloadLink.click();
    downloadLink.remove();
  }
}

/**
 * Get the file format based on the user selection for the petri net download (here: used like an if request)
 * @param fileFormat of the file that should be downloaded
 * @returns fileFormat
 */
function getFileEndingForFormat(fileFormat: DownloadFormat): string {
  return fileFormat === 'pn' ? 'pn' : 'pnml';
}

/**
 * Get the file format for the log download. Can be extended later to different formats
 * @param fileFormat of the file that should be downloaded
 * @returns fileFormat
 */
function getFileEndingForFormatLog(fileFormat: DownloadFormat): string {
  return fileFormat === 'txt' ? 'txt' : 'txt';
}
