import { eventSize } from '../../../services/svg/svg-constants';
import { Coordinates } from '../coordinates';

/**
 * Calculates the intersection of an event with a line
 * @param sourceX X position of the event center
 * @param sourceY Y position of the event center
 * @param targetX X Position of the arrow target
 * @param targetY Y Position of the arrow target
 * @param backwards false = Arrow starts at the event | false = Arrow ends at the event
 * @returns X and Y position
 */
export function getIntersection(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  backwards: boolean
): Coordinates {
  if (targetY == sourceY) {
    return {
      x: sourceX + (backwards ? -eventSize : eventSize) / 2,
      y: sourceY,
    };
  }

  const point = {
    x: sourceX + (backwards ? -eventSize : eventSize) / 2,
    y: 0,
  };
  const m = (targetY - sourceY) / (targetX - sourceX);
  const n = sourceY - sourceX * m;
  point.y = (sourceX + (backwards ? -eventSize : eventSize) / 2) * m + n;

  // Check if the intersection is out of the event bounds. If so then calculate intersection on the top/bottom line of the event.
  if (point.y < sourceY - eventSize / 2) {
    point.y = sourceY - eventSize / 2;
    point.x = (point.y - n) / m;
  } else if (point.y > sourceY + eventSize / 2) {
    point.y = sourceY + eventSize / 2;
    point.x = (point.y - n) / m;
  }
  return point;
}
