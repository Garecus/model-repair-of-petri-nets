import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-template-button',
  templateUrl: './template-button.component.html',
  styleUrls: ['./template-button.component.scss'],
})

/**
   * This whole component handles the template button (big button in the UI, e.g. for uploading)
   */
export class TemplateButtonComponent {
  @Input() styleClass?: string;
  @Input() buttonText: string | undefined;
  @Input() buttonIcon: string | undefined;
  @Output() buttonAction = new EventEmitter<void>();
  @Output() dropAction = new EventEmitter<DragEvent>();

  prevent(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  hoverStart(e: MouseEvent): void {
    this.prevent(e);
    const target = e.target as HTMLElement;
    target.classList.add('mouse-hover');
  }

  hoverEnd(e: MouseEvent): void {
    this.prevent(e);
    const target = e.target as HTMLElement;
    target.classList.remove('mouse-hover');
  }

  processMouseClick(): void {
    this.buttonAction.emit();
  }

  processDrop(e: DragEvent): void {
    this.prevent(e);
    const target = e.target as HTMLElement;
    target.classList.remove('drag-hover');

    this.dropAction.emit(e);
  }

  dragStart(e: DragEvent): void {
    this.prevent(e);
    const target = e.target as HTMLElement;
    target.classList.add('drag-hover');
  }

  dragEnd(e: DragEvent): void {
    this.prevent(e);
    const target = e.target as HTMLElement;
    target.classList.remove('drag-hover');
  }
}
