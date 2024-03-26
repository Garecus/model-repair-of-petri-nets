import { Component, OnInit } from '@angular/core';
import saveAs from 'file-saver';
import JSZip from 'jszip';
import { andLog, andPetriNet, loopLog, loopPetriNet, skipLog, skipNet, coffeeMachineLog, coffeeMachineNet, firstLog, firstPetriNet, secondLog, secondPetriNet, thirdLog, thirdPetriNet } from 'src/app/services/upload/simple-example/evaluation/evaluation';
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

  /**
   * Reads a file based on
   * @param filePath in the directory
   * @returns the read file
   */
  private readFile(filePath: string): Promise<Blob> {
    return fetch(filePath).then((response) => response.blob());
  }

  /**
   * Downloads the simple example files (by default deactivated in the html) [fitness model repair]
   */
  downloadExample(): void {
    const zip = new JSZip();
    zip.file('simple-example-net.pn', simpleExamplePetriNet);
    zip.file('simple-example-log.log', simpleExampleLog);
    zip.generateAsync({ type: 'blob' }).then((content) => {
      saveAs(content, 'simple-example.zip');
    });
  }

  /**
   * Downloads the evaluation & example files [fitness model repair]
   */
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
      saveAs(content, 'evaluation_examples_fitness.zip');
    });
  }

  /**
   * Downloads the evaluation & example files [precision model repair]
   */
  downloadEvaluationFilesPrecision(): void {
    const zip = new JSZip();

    const firstFolder = zip.folder('1 - evaluation');
    firstFolder?.file('1-evaluation.log', firstLog);
    firstFolder?.file('1-evaluation.pn', firstPetriNet);

    const secondFolder = zip.folder('2 - evaluation');
    secondFolder?.file('2-evaluation.log', secondLog);
    secondFolder?.file('2-evaluation.pn', secondPetriNet);

    const thirdFolder = zip.folder('3 - evaluation');
    thirdFolder?.file('3-evaluation.log', thirdLog);
    thirdFolder?.file('3-evaluation.pn', thirdPetriNet);

    zip.generateAsync({ type: 'blob' }).then((content) => {
      saveAs(content, 'evaluation_examples_precision.zip');
    });
  }
}
