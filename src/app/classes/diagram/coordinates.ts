/**
   * Contains all the coordinate information that are used in the displayed process model
   */
  
export type CoordinatesInfo = {
  transitionName: string;
  transitionType: string;
  coordinates: Coordinates;
  globalOffset: Coordinates;
};

export type Coordinates = {
  x: number;
  y: number;
};
