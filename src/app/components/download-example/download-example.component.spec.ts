import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DownloadExampleComponent } from './download-example.component';

describe('DownloadExampleComponent', () => {
  let component: DownloadExampleComponent;
  let fixture: ComponentFixture<DownloadExampleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ DownloadExampleComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DownloadExampleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
