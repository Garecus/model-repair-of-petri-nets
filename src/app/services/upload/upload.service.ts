import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { Observable, ReplaySubject, Subject } from 'rxjs';

import { netTypeKey } from '../parser/parsing-constants';
import { getRunTextFromPnml } from './pnml/pnml-to-run.fn';
import { parseXesFileToCustomLogFormat } from './xes/xes-parser';

export type StructureType = 'petri-net' | 'log';

const allowedExtensions: { [key in StructureType]: string[] } = {
  'petri-net': ['pn', 'pnml'],
  log: ['txt', 'log', 'xes'],
};

@Injectable({
  providedIn: 'root',
})
export class UploadService {
  private currentNetUpload$: Subject<string>;
  private currentLogUpload$: Subject<string>;

  constructor(private toastr: ToastrService) {
    this.currentNetUpload$ = new ReplaySubject<string>(1);
    this.currentLogUpload$ = new ReplaySubject<string>(1);
  }

  /**
   * This will display the net in the view in text format
   * @param text custom format petri net
   */
  setUploadNet(text: string): void {
    this.currentNetUpload$.next(text);
  }

  /**
 * This will display the log in the view in text format
 * @param text custom format log
 */
  setUploadLog(text: string): void {
    this.currentLogUpload$.next(text);
  }

  /**
 * This will get the net from the view in text format
 * @param text custom format petri net
 */
  getNetUpload$(): Observable<string> {
    return this.currentNetUpload$.asObservable();
  }

  /**
* This will get the log from the view in text format
* @param text custom format log
*/
  getLogUpload$(): Observable<string> {
    return this.currentLogUpload$.asObservable();
  }

  /**
   * This will open the popup to select files and upload them
   * @param type to identify whether a log or net will be uploaded
   */
  openFileSelector(type?: StructureType): void {
    const fileUpload = document.createElement('input');
    fileUpload.setAttribute('type', 'file');
    // Allow to upload two files at once in the select file option
    fileUpload.setAttribute('multiple', 'true');

    const relevantExtensions = type
      ? allowedExtensions[type]
      : Object.values(allowedExtensions).flat();

    fileUpload.setAttribute(
      'accept',
      relevantExtensions.map((e) => '.' + e).join(',')
    );
    fileUpload.onchange = (event) => {
      if (event.target instanceof HTMLInputElement && event.target?.files) {
        this.uploadFiles(event.target.files);
      }
    };

    fileUpload.click();
  }

  /**
   * This will really upload the files and parse them based on the fileExtension
   * @param files uploaded files by the user
   * @param type type of the files
   * @returns error message or nothing
   */
  uploadFiles(files: FileList, type?: StructureType): void {
    const filteredFiles = Array.from(files).filter((file) =>
      fileExtensionIsValid(file.name, type)
    );
    if (filteredFiles.length === 0) {
      this.toastr.error("Couldn't find any valid file");
      return;
    }

    filteredFiles.forEach((file) => {
      const reader = new FileReader();
      const fileExtension = getExtensionForFileName(file.name);

      reader.onload = () => {
        let content: string = reader.result as string;

        if (fileExtension?.toLowerCase() === 'pnml') {
          content = getRunTextFromPnml(content);
        }
        if (fileExtension?.toLowerCase() === 'xes') {
          content = parseXesFileToCustomLogFormat(content);
        }
        this.processNewSource(content);
      };

      reader.readAsText(file);
    });

    if (filteredFiles.length === 1) {
      this.toastr.success(`Processed file`);
    } else {
      this.toastr.success(`Processed files`);
    }
  }

  /**
   * If there is later a new source added, then update
   * @param newSource a new string with log / net data
   */
  private processNewSource(newSource: string): void {
    if (newSource.trim().startsWith(netTypeKey)) {
      this.currentNetUpload$.next(newSource);
    } else {
      this.currentLogUpload$.next(newSource);
    }
  }
}

/**
 * Check that the file extension is valid and can be parsed
 * @param fileName of the file to check the file extension
 * @param type of the file
 * @returns true or false
 */
function fileExtensionIsValid(fileName: string, type?: StructureType): boolean {
  const fileExtension = getExtensionForFileName(fileName);
  if (!fileExtension) {
    return false;
  }

  const relevantExtensions = type
    ? allowedExtensions[type]
    : Object.values(allowedExtensions).flat();
  return relevantExtensions.includes(fileExtension.trim());
}

/**
 * Get the extension out of the file name to be able to parse it correctly
 * @param fileName of the uploaded file
 * @returns the file exenstion string
 */
function getExtensionForFileName(fileName: string): string | undefined {
  return fileName.split('.').pop();
}
