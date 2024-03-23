/**
   * Types to handle the parsing and computation for the pnml format (upload / download)
   */

export type PnmlWrapper = {
  pnml: {
    net: {
      page?: PnmlPage;
    } & PnmlPage;
  };
};

export type PnmlPage = {
  arc: PnmlArc[];
  place: PnmlPlace[];
  transition: PnmlTransitions[];
};

type PnmlArc = {
  source: string;
  target: string;
};

type PnmlPlace = {
  id: string;
  name: {
    text: string;
  };
  initialMarking: {
    text: number;
  };
};

type PnmlTransitions = {
  id: string;
  name?: {
    text?: string;
  };
};
