import { PetriNet } from '../../../classes/diagram/petri-net';
import { Place } from '../../../classes/diagram/place';
import { Transition } from '../../../classes/diagram/transition';

const encoding = '<?xml version="1.0" encoding="UTF-8"?>\n';

const transitionDimension = 40;

/**
 * Convert the petri net object to a pnml string to download it
 * @param name of the file
 * @param petriNet with all elements
 * @returns a string with all petri net elements in the pnml format
 */
export function convertPetriNetToPnml(
     name: string,
     petriNet: PetriNet
): string {
     const transitionText = petriNet.transitions
          .map((element) => parseTransition(element))
          .join(`\n`);

     const placesText = parsePlaces(petriNet.places);
     const arcsText = parseArcs(petriNet);

     return `${encoding}
<pnml>
     <net id="" type="http://www.pnml.org/version-2009/grammar/ptnet">
          <name>
               <text>${name}</text>
          </name>
          <page id="p1">\n${transitionText}\n${placesText}\n${arcsText}
          </page>
     </net>
</pnml>`;
}

/**
 * Converts the specific element of a transition to pnml
 * @param transition of the petri net object
 * @returns a string including the transition and all property information in the pnml format
 */
function parseTransition(transition: Transition): string {
     return `               <transition id="${transition.id}">
                    <name>
                        <text>${transition.label}</text>
                        <graphics>
                             <offset x="${transition.x ?? 0}" y="${(transition.y ?? 0) + transitionDimension
          }"/>
                        </graphics>
                    </name>
                    <graphics>
                         <position x="${transition.x ?? 0}" y="${transition.y ?? 0
          }"/>
                         <dimension x="${transitionDimension}" y="${transitionDimension}"></dimension>
                    </graphics>
               </transition>`;
}

/**
 * Converts the specific element of a place to pnml
 * @param places of the petri net object
 * @returns a string including all places and all property information in the pnml format
 */
function parsePlaces(places: Place[]): string {
     return places
          .map((place) => {
               return `               <place id="${place.id}">
                    <name>
                         <text>${place.id}</text>
                         <graphics>
                              <offset x="${place.x ?? 0}" y="${(place.y ?? 0) + transitionDimension ?? 0
                    }"/>
                         </graphics>
                    </name>
                    <graphics>
                         <position x="${place.x ?? 0}" y="${place.y ?? 0}"/>
                    </graphics>
                    <initialMarking>
                         <text>${place.marking}</text>
                    </initialMarking>
               </place>`;
          })
          .join(`\n`);
}

/**
 * Converts the specific element of an arc to pnml
 * @param petriNet of the petri net object
 * @returns a string including all arcs and all property information in the pnml format
 */
function parseArcs(petriNet: PetriNet): string {
     return petriNet.arcs
          .map(
               (arc) => `               <arc id="A"
                    source="${arc.source}" target="${arc.target}">
                    <inscription>
                        <text>1</text>
                    </inscription>
                    <graphics/>
               </arc>`
          )
          .join(`\n `);
}
