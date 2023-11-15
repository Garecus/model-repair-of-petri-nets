import { Point } from '@angular/cdk/drag-drop';
import {
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {
  BehaviorSubject,
  map,
  Observable,
  Subject,
  Subscription,
  switchMap,
} from 'rxjs';

import { LayoutResult } from '../../services/layout/layout.service';
import { SvgService } from '../../services/svg/svg.service';
import { bindEventsForNet } from './bind-events.fn';
// todo
@Component({
  selector: 'app-canvas',
  templateUrl: './canvas.component.html',
  styleUrls: ['./canvas.component.scss'],
})
export class CanvasComponent implements OnInit, OnDestroy {
  @ViewChild('drawingArea') drawingArea: ElementRef<SVGElement> | undefined;

  @Input()
  layoutResult$?: Observable<LayoutResult & { renderChanges: boolean }>;

  @Input()
  canvasHeight = 400;

  private readonly mouseMoved$: Subject<MouseEvent>;
  private readonly mouseUp$: Subject<MouseEvent>;
  private readonly redrewRequest$ = new BehaviorSubject<void>(undefined);

  private _sub: Subscription | undefined;

  private offset: Point = { x: 0, y: 0 };
  private dragging = false;
  private lastPoint?: Point;

  private kill$?: Subject<void>;

  constructor(private svgService: SvgService) {
    this.mouseMoved$ = new Subject<MouseEvent>();
    this.mouseUp$ = new Subject<MouseEvent>();
  }

  ngOnDestroy(): void {
    this._sub?.unsubscribe();
  }

  ngOnInit(): void {
    this.layoutResult$
      ?.pipe(
        map(({ net, point, renderChanges }) => {
          let offset: Point;

          if (this.kill$) {
            this.kill$.next();
            this.kill$.complete();
          }
          this.kill$ = new Subject<void>();

          bindEventsForNet(
            net,
            this.mouseMoved$,
            this.mouseUp$,
            this.redrewRequest$,
            this.kill$.asObservable()
          );

          if (this.drawingArea) {
            const canvasWidth = this.drawingArea.nativeElement.clientWidth;
            const canvasHeight = this.drawingArea.nativeElement.clientHeight;

            offset = {
              x: Math.floor((canvasWidth - point.x) / 2),
              y: Math.floor((canvasHeight - point.y) / 2),
            };
          } else {
            offset = { x: 0, y: 0 };
          }
          this.offset = offset;
          return { net, renderChanges };
        }),
        switchMap(({ net, renderChanges }) =>
          this.redrewRequest$.pipe(
            map(() => {
              return this.svgService.createNetElements(
                net,
                this.offset,
                renderChanges
              );
            })
          )
        )
      )
      .subscribe((elements) => {
        if (!this.drawingArea) {
          return;
        }

        this.clearDrawingArea();
        for (const element of elements) {
          this.drawingArea.nativeElement.appendChild(element);
        }
      });
  }

  private clearDrawingArea() {
    const drawingArea = this.drawingArea?.nativeElement;
    if (drawingArea?.childElementCount === undefined) {
      return;
    }

    while (drawingArea.childElementCount > 1 /* keep arrowhead marker */) {
      drawingArea.removeChild(drawingArea.lastChild as ChildNode);
    }

    drawingArea.style.height = `${this.canvasHeight}px`;
  }

  processMouseDown(event: MouseEvent): void {
    this.dragging = true;
    this.lastPoint = { x: event.x, y: event.y };
  }

  shareMouseMoved(event: MouseEvent): void {
    this.mouseMoved$.next(event);

    if (!this.lastPoint) {
      this.lastPoint = { x: event.x, y: event.y };
    }

    if (this.dragging) {
      this.offset = {
        x: this.offset.x + event.x - this.lastPoint.x,
        y: this.offset.y + event.y - this.lastPoint.y,
      };
      if (this.lastPoint) {
        this.lastPoint.x = event.x;
        this.lastPoint.y = event.y;
      }
      this.redrewRequest$.next();
    }
  }

  shareMouseUp(event: MouseEvent): void {
    this.mouseUp$.next(event);
    this.dragging = false;
    this.lastPoint = undefined;
  }
}
