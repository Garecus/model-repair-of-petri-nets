import { TestBed } from '@angular/core/testing';

import { DisplayService } from '../display.service';
import { DownloadService } from './download.service';
import { RunToPnmlService } from './run-to-pnml/run-to-pnml.service';

describe('DownloadService', () => {
  let service: DownloadService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DisplayService, useValue: {} },
        { provide: RunToPnmlService, useValue: {} },
      ],
    });
    service = TestBed.inject(DownloadService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
