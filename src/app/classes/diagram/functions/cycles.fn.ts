import { Arc } from '../arc';
import { PetriNet } from '../petri-net';

/**
 * Gets all cycles from a petri net
 * @param run to get the cycles from
 * @returns all the cyclic arcs
 */
export function getCycles(run: PetriNet): Arc[] {
  const visitedArcs = new Set<Arc>();
  const cyclicArcs: Arc[] = [];

  const visitedTransitions = new Set<string>();
  run.arcs.forEach((arc) => {
    checkArcCycle(run, arc, visitedArcs, visitedTransitions, cyclicArcs);
  });
  return cyclicArcs;
}

/**
 * Checks an arc sequence for cycles
 * @param currentRun run to parse
 * @param arc starting arc
 * @param visitedArcs already visited arcs
 * @param visitedTransitions already visited transition
 * @param cyclicArcs last arcs when a cycle occurs
 */
function checkArcCycle(
  currentRun: PetriNet,
  arc: Arc,
  visitedArcs: Set<Arc>,
  visitedTransitions: Set<string>,
  cyclicArcs: Arc[]
): void {
  const target = currentRun.transitions.find(
    (element) => element.id === arc.target
  );
  if (visitedArcs.has(arc) || !target) {
    return;
  }
  visitedArcs.add(arc);

  // Transition already visited in this sequence, if yes return
  if (visitedTransitions.has(target.id)) {
    cyclicArcs.push(arc);
    return;
  }
  visitedTransitions.add(target.id);

  // Continue with all sequences
  target.outgoingArcs.forEach((outArc) => {
    checkArcCycle(
      currentRun,
      outArc,
      visitedArcs,
      visitedTransitions,
      cyclicArcs
    );
  });
}
