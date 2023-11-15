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

  setUploadText(text: string): void {
    this.currentNetUpload$.next(text);
  }

  getNetUpload$(): Observable<string> {
    return this.currentNetUpload$.asObservable();
  }

  getLogUpload$(): Observable<string> {
    return this.currentLogUpload$.asObservable();
  }

  openFileSelector(type?: StructureType): void {
    const fileUpload = document.createElement('input');
    fileUpload.setAttribute('type', 'file');
    fileUpload.setAttribute('multiple', 'true'); // Allows to upload to file at once in the select file option

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

  private processNewSource(newSource: string): void {
    if (newSource.trim().startsWith(netTypeKey)) {
      this.currentNetUpload$.next(newSource);
    } else {
      this.currentLogUpload$.next(newSource);
    }
  }
}

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

function getExtensionForFileName(fileName: string): string | undefined {
  return fileName.split('.').pop();
}
