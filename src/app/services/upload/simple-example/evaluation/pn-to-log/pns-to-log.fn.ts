import { Breakpoint } from '../../../../../classes/diagram/arc';
import {
  addArc,
  addPlace,
  addTransition,
  getElementsWithArcs,
} from '../../../../../classes/diagram/functions/net-helper.fn';
import { PetriNet } from '../../../../../classes/diagram/petri-net';
import { Place } from '../../../../../classes/diagram/place';
import { Transition } from '../../../../../classes/diagram/transition';
import {
  arcsAttribute,
  netTypeKey,
  placesAttribute,
  transitionsAttribute,
} from '../../../../parser/parsing-constants';
import { pns } from './pns';

export function pnsToLog(): string {
  const parsedNets = pns.map((net) => {
    const errors = new Set<string>();
    return parsePetriNet(net, errors)!;
  });

  let log = `.type log
.attributes
case-id
event-id
concept:name
follows[]
.events
`;

  for (let netIndex = 0; netIndex < parsedNets.length; netIndex++) {
    const net = parsedNets[netIndex];

    for (const transition of net.transitions) {
      const placeArcs = net.arcs.filter((arc) => arc.target === transition.id);
      const previousTransitionArcs = placeArcs.flatMap((place) =>
        net.arcs.filter((arc) => arc.target === place.source)
      );

      const follows = `[${previousTransitionArcs.map((arc) => arc.source)}]`;
      log += `${netIndex + 1} ${transition.id} ${transition.label
        } ${follows}\n`;
    }
  }

  return log;
}

type ParsingStates = 'initial' | 'type' | 'transitions' | 'places' | 'arcs';

function parsePetriNet(content: string, errors: Set<string>): PetriNet | null {
  const contentLines = content.split('\n');
  const petriNet: PetriNet = {
    transitions: [],
    arcs: [],
    places: [],
  };

  let currentParsingState: ParsingStates = 'initial';

  for (const line of contentLines) {
    const trimmedLine = line.trim();
    if (trimmedLine === '') {
      continue;
    }

    switch (currentParsingState) {
      case 'initial':
        if (trimmedLine === netTypeKey) {
          currentParsingState = 'type';
          break;
        } else {
          errors.add(
            `The type of the file with the net has to be '` + netTypeKey + `'`
          );
          return null;
        }
      case 'type':
        if (trimmedLine === transitionsAttribute) {
          currentParsingState = 'transitions';
          break;
        } else if (trimmedLine === arcsAttribute) {
          currentParsingState = 'arcs';
          break;
        } else if (trimmedLine === placesAttribute) {
          currentParsingState = 'places';
          break;
        } else {
          errors.add(`The file contains invalid parts`);
          return null;
        }
      case 'transitions':
        if (trimmedLine !== arcsAttribute && trimmedLine !== placesAttribute) {
          const transition = parseTransition(trimmedLine);
          addTransition(petriNet, transition);
          break;
        } else if (trimmedLine === arcsAttribute) {
          currentParsingState = 'arcs';
          break;
        } else if (trimmedLine === placesAttribute) {
          currentParsingState = 'places';
          break;
        } else {
          errors.add(`Unable to parse file`);
          return null;
        }
      case 'places':
        if (
          trimmedLine !== arcsAttribute &&
          trimmedLine !== transitionsAttribute
        ) {
          const place = parsePlace(trimmedLine);
          addPlace(petriNet, place); //XXX
          break;
        } else if (trimmedLine === arcsAttribute) {
          currentParsingState = 'arcs';
          break;
        } else if (trimmedLine === transitionsAttribute) {
          currentParsingState = 'transitions';
          break;
        } else {
          errors.add(`Unable to parse file`);
          return null;
        }
      case 'arcs':
        if (
          trimmedLine !== transitionsAttribute &&
          trimmedLine !== placesAttribute
        ) {
          let source: string, target: string, weight: number;
          const breakpoints: Breakpoint[] = [];

          const arcRegex = /^(\S*)\s*(\S*)\s*(\d*)$/;
          if (arcRegex.test(trimmedLine)) {
            const match = arcRegex.exec(trimmedLine);

            if (match) {
              source = match[1];
              target = match[2];
              weight = Number(match[3]);
            } else {
              const splitLine = trimmedLine.split(' ');
              source = splitLine[0];
              target = splitLine[1];
              weight = Number(splitLine[2]);
            }

            const elements = getElementsWithArcs(petriNet);
            const parsedSource = elements.find(
              (transition) => transition.id === source
            );
            const parsedTarget = elements.find(
              (transition) => transition.id === target
            );
            if (!parsedSource || !parsedTarget) {
              errors.add(`An arc between ${source} and ${target} is invalid`);
              throw Error(`An arc between ${source} and ${target} is invalid`);
            }

            const arc = {
              weight: weight || 1,
              source: source,
              target: target,
              breakpoints: breakpoints,
            };
            addArc(petriNet, arc);
          }
          break;
        } else if (trimmedLine === transitionsAttribute) {
          currentParsingState = 'transitions';
          break;
        } else {
          errors.add(`Unable to parse file`);
          return null;
        }
    }
  }

  if (petriNet.arcs.length === 0 && petriNet.transitions.length === 0) {
    errors.add(`Petri net does not contain events and arcs`);
    return null;
  }

  return petriNet;
}

function parseTransition(trimmedLine: string): Transition {
  const match = /^(\S*)\s*(.*)$/.exec(trimmedLine);
  const id = match ? match[1] : trimmedLine;
  const label = match ? match[2] || match[1] : trimmedLine;

  return {
    id,
    label,
    type: 'transition',
    incomingArcs: [],
    outgoingArcs: [],
  };
}

function parsePlace(trimmedLine: string): Place {
  const match = /^(\S*)\s*(\d*)$/.exec(trimmedLine);
  const id = match ? match[1] : trimmedLine;
  const tokens = match ? Number(match[2]) : 0;

  return {
    id,
    type: 'place',
    marking: isNaN(tokens) ? 0 : tokens,
    incomingArcs: [],
    outgoingArcs: [],
  };
}
