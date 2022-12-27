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
  downloadName = '';
  compression = false;

  constructor(
    private dialogRef: MatDialogRef<DownloadPopoverComponent>,
    private _downloadService: DownloadService
  ) {}

  download(): void {
    this._downloadService.downloadNet(this.downloadName, this.fileFormat);
    this.closePopover();
  }

  closePopover(): void {
    this.dialogRef.close();
  }
}
