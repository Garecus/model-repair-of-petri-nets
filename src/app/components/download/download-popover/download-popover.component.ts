import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

import { DownloadService } from '../../../services/download/download.service';
import { DownloadFormat } from '../download.const';

@Component({
  selector: 'app-download-popover',
  templateUrl: './download-popover.component.html',
  styleUrls: ['./download-popover.component.scss'],
})
export class DownloadPopoverComponent {
  fileFormat: DownloadFormat = 'pn';
  fileFormatLog: DownloadFormat = 'txt';
  downloadLog = 'no';
  downloadName = '';
  compression = false;

  constructor(
    private dialogRef: MatDialogRef<DownloadPopoverComponent>,
    private _downloadService: DownloadService
  ) { }

  /**
   * Calls the download service to start the download including the download name and file format (net and log)
   */
  download(): void {
    this._downloadService.downloadNet(this.downloadName, this.fileFormat);
    if (this.downloadLog == 'yes') {
      this._downloadService.downloadLog(this.downloadName, this.fileFormatLog);
    }
    this.closePopover();
  }

  /**
 * Will close the download popup
 */
  closePopover(): void {
    this.dialogRef.close();
  }
}
