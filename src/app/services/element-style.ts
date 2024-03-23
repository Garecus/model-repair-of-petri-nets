/** Handling style details of the elements in the displayed process model
 */

// Style details of the drawn petri net in the canvas
export interface TransitionStyle {
  width: string;
  height: string;
}

// Style details of transitions
export const TRANSITION_STYLE = {
  rx: '1',
  ry: '1',
  width: '42',
  height: '42',
  stroke: 'black',
  'stroke-width': '2',
  'fill-opacity': '0',
};

// Style details of places
export const PLACE_STYLE = {
  r: '21',
  stroke: 'black',
  'stroke-width': '2',
  'fill-opacity': '0',
};

// Style details of arcs
export const ARC_STYLE = {
  stroke: 'black',
  'stroke-width': '1',
};

// Style details of arc heads
export const ARC_END_STYLE = {
  'marker-end': 'url(#arrowhead)',
};

// Unknown todo
export const DRAG_POINT_STYLE = {
  r: '10',
};

// Style details of the text below or inside the elements
export const TEXT_STYLE = {
  'text-anchor': 'middle', // horizontal alignment
  'dominant-baseline': 'central', // vertical alignment
  'pointer-events': 'none',
  style: 'user-select: none',
};
