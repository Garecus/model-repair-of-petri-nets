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

  downloadNet(name: string, fileFormat: DownloadFormat): void {
    this.displayService
      .getPetriNet$()
      .pipe(first())
      .subscribe((run) => {
        const fileEnding = getFileEndingForFormat(fileFormat);
        const fileName = name
          ? `${name}-net.${fileEnding}`
          : `${Date.now()}-net.${fileEnding}`;

        this.downloadRun(fileName, fileFormat, run);
      });
  }

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

  private downloadRun(
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

  private downloadLogRun(
    name: string,
    fileFormatLog: DownloadFormat,
    partialOrder: PartialOrder[]
  ): void {
    //const fileContent = JSON.stringify(partialOrder);
    const fileContent =
      fileFormatLog === 'txt'
        ? generateTextFromLog(partialOrder)
        : JSON.stringify(partialOrder);

    const downloadLink: HTMLAnchorElement = document.createElement('a');
    downloadLink.download = name;
    downloadLink.href =
      'data:text/plain;charset=utf-16,' + encodeURIComponent(fileContent);
    downloadLink.click();
    downloadLink.remove();
  }
}


function getFileEndingForFormat(fileFormat: DownloadFormat): string {
  return fileFormat === 'pn' ? 'pn' : 'pnml';
}

function getFileEndingForFormatLog(fileFormat: DownloadFormat): string {
  return fileFormat === 'txt' ? 'txt' : 'txt';
}
