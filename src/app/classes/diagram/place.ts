import { ConcreteElementWithArcs } from './draggable';
/**
   * Contains all the place information that are used in the displayed process model
   */

export interface Place extends ConcreteElementWithArcs {
  type: 'place';
  marking: number;
  // Warning and error are fitness related. Possibility and implicit mark the related precision status.
  issueStatus?: 'warning' | 'error' | 'possibility' | 'implicit';
}
