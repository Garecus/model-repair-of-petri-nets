import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { DisplayService } from '../display.service';
import { parsedPetriNet } from '../upload/example-file-parsed';
import { UploadService } from '../upload/upload.service';
import { NetCommandService } from './net-command.service';

describe('NetCommandService', () => {
  let service: NetCommandService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: UploadService,
          useValue: {
            setUploadNet: jest.fn(),
          },
        },
        {
          provide: DisplayService,
          useValue: {
            getPetriNet$: jest.fn().mockReturnValue(of(parsedPetriNet)),
          },
        },
      ],
    });
    service = TestBed.inject(NetCommandService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return null for unknown place', (done) => {
    service
      .repairNet('XX', { type: 'marking', newMarking: 42 })
      .subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
  });

  it('should update weight for petri net', (done) => {
    service
      .repairNet('p2', { type: 'marking', newMarking: 42 })
      .subscribe((net) => {
        expect(net).toEqual(`.type pn
.transitions
a a
b b
c c
d d
e e
f f
.places
p1 2
p2 42
p3 1
p4 2
p5 1
p6 0
p7 1
.arcs
p1 a
a p2
p2 c
c p5
p5 a
p2 b
b p3
p3 d
d p7
p7 d
p7 c
c p7
d p6
c p4
p4 e 3
e p6
p6 f 3`);
        done();
      });
  });

  it('should generate text for modify-place', (done) => {
    service
      .repairNet('p2', {
        type: 'modify-place',
        incoming: [
          { transitionLabel: 'd', weight: 5 },
          { transitionLabel: 'f', weight: 6 },
        ],
        outgoing: [
          { transitionLabel: 'a', weight: 8 },
          { transitionLabel: 'b', weight: 9 },
        ],
        newMarking: 42,
      })
      .subscribe((net) => {
        expect(net).toEqual(`.type pn
.transitions
a a
b b
c c
d d
e e
f f
.places
p1 2
p2 42
p3 1
p4 2
p5 1
p6 0
p7 1
.arcs
p1 a
c p5
p5 a
b p3
p3 d
d p7
p7 d
p7 c
c p7
d p6
c p4
p4 e 3
e p6
p6 f 3
d p2 5
f p2 6
p2 a 8
p2 b 9`);
        done();
      });
  });

  it('should generate text for replace-place', (done) => {
    service
      .repairNet('p2', {
        type: 'replace-place',
        repairType: 'multiplePlaces',
        places: [
          {
            incoming: [
              { transitionLabel: 'd', weight: 5 },
              { transitionLabel: 'f', weight: 6 },
            ],
            outgoing: [
              { transitionLabel: 'a', weight: 8 },
              { transitionLabel: 'b', weight: 9 },
            ],
          },
          {
            incoming: [{ transitionLabel: 'e', weight: 5 }],
            outgoing: [
              { transitionLabel: 'a', weight: 8 },
              { transitionLabel: 'c', weight: 9 },
            ],
          },
        ],
        regionSize: 1,
      })
      .subscribe((net) => {
        expect(net).toEqual(`.type pn
.transitions
a a
b b
c c
d d
e e
f f
.places
p1 2
p2_0 0
p2_1 0
p3 1
p4 2
p5 1
p6 0
p7 1
.arcs
p1 a
c p5
p5 a
b p3
p3 d
d p7
p7 d
p7 c
c p7
d p6
c p4
p4 e 3
e p6
p6 f 3
d p2_0 5
f p2_0 6
p2_0 a 8
p2_0 b 9
e p2_1 5
p2_1 a 8
p2_1 c 9`);
        done();
      });
  });
});
