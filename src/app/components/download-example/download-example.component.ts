import { Component, OnInit } from '@angular/core';
import saveAs from 'file-saver';
import JSZip from 'jszip';
import { andLog, andPetriNet, loopLog, loopPetriNet, skipLog, skipNet, coffeeMachineLog, coffeeMachineNet, firstLog, firstPetriNet, secondLog, secondPetriNet } from 'src/app/services/upload/simple-example/evaluation/evaluation';
import { simpleExampleLog, simpleExamplePetriNet } from 'src/app/services/upload/simple-example/simple-example-texts';

@Component({
  selector: 'app-download-example',
  templateUrl: './download-example.component.html',
  styleUrls: ['./download-example.component.scss']
})
export class DownloadExampleComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

  private readFile(filePath: string): Promise<Blob> {
    return fetch(filePath).then((response) => response.blob());
  }

  // Simple example files (in default deactivated in the html) [Fitness model repair]
  downloadExample(): void {
    const zip = new JSZip();
    zip.file('simple-example-net.pn', simpleExamplePetriNet);
    zip.file('simple-example-log.log', simpleExampleLog);
    zip.generateAsync({ type: 'blob' }).then((content) => {
      saveAs(content, 'simple-example.zip');
    });
  }

  // Evaluation & example files [Fitness model repair]
  downloadEvaluationFiles(): void {
    const zip = new JSZip();

    const andFolder = zip.folder('1 - and');
    andFolder?.file('and.log', andLog);
    andFolder?.file('and.pn', andPetriNet);

    const loopFolder = zip.folder('2 - loop');
    loopFolder?.file('loop.log', loopLog);
    loopFolder?.file('loop.pn', loopPetriNet);

    const eventSkipFolder = zip.folder('3 - event-skip');
    eventSkipFolder?.file('event-skip.log', skipLog);
    eventSkipFolder?.file('event-skip.pn', skipNet);

    const coffeeMachine = zip.folder('4 - coffee-machine');
    coffeeMachine?.file('coffee-machine.log', coffeeMachineLog);
    coffeeMachine?.file('coffee-machine.pn', coffeeMachineNet);
    coffeeMachine?.file(
      '1-halbordnung.png',
      this.readFile('assets/1-halbordnung.png'),
      {
        binary: true,
      }
    );
    coffeeMachine?.file(
      '2-halbordnung.png',
      this.readFile('assets/2-halbordnung.png'),
      {
        binary: true,
      }
    );

    zip.generateAsync({ type: 'blob' }).then((content) => {
      saveAs(content, 'evaluation.zip');
    });
  }

  // Evaluation & example files [Precision model repair]
  downloadEvaluationFilesPrecision(): void {
    const zip = new JSZip();

    const firstFolder = zip.folder('1 - example');
    firstFolder?.file('1-example.log', firstLog);
    firstFolder?.file('1-example.pn', firstPetriNet);

    const secondFolder = zip.folder('2 - example');
    secondFolder?.file('2-example.log', secondLog);
    secondFolder?.file('2-example.pn', secondPetriNet);

    zip.generateAsync({ type: 'blob' }).then((content) => {
      saveAs(content, 'evaluation_examples.zip');
    });
  }

}
