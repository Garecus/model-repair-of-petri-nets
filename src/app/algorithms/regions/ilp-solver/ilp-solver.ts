import { GLPK, LP, Result } from 'glpk.js';
import clonedeep from 'lodash.clonedeep';
import {
  combineLatest,
  concatMap,
  map,
  Observable,
  of,
  ReplaySubject,
  switchMap,
  toArray,
} from 'rxjs';

import { PartialOrder } from '../../../classes/diagram/partial-order';
import { PetriNet } from '../../../classes/diagram/petri-net';
import { Place } from '../../../classes/diagram/place';
import { EventItem } from '../../../classes/diagram/transition';
import { arraify } from '../arraify';
import { ConstraintsWithNewVariables } from './constraints-with-new-variables';
import { DirectlyFollowsExtractor } from './directly-follows-extractor';
import {
  Bound,
  ProblemSolution,
  ProblemSolutionWithoutType,
  SolutionType,
  SolutionVariable,
  SubjectTo,
  Variable,
  VariableName,
  VariableType,
  Vars,
} from './solver-classes';
import { Constraint, Goal, MessageLevel, Solution } from './solver-constants';

export type SolutionGeneratorType =
  | {
    type: 'repair' | 'warning' | 'possibility';
    placeId: string;
  }
  | {
    type: 'transition';
    newTransition: string;
  }
  /* | { 
    type: 'repair' | 'warning' | 'possibility';
    transitionId: string;
  } */;

export class IlpSolver {
  private readonly PO_ARC_SEPARATOR = '_';
  private readonly FINAL_MARKING = 'mf';

  private variableCount = 0;
  private constraintCount = 0;

  private readonly allVariables: Set<string>;
  private readonly poVariableNames: Set<string>;

  private readonly labelVariableMapIngoing: Map<string, string>;
  private readonly labelVariableMapOutgoing: Map<string, string>;
  private readonly inverseLabelVariableMapIngoing: Map<string, string>;
  private readonly inverseLabelVariableMapOutgoing: Map<string, string>;
  private readonly directlyFollowsExtractor: DirectlyFollowsExtractor;

  private readonly baseIlp: LP;
  private readonly pairs: Array<[first: string | undefined, second: string]>;

  private constraintsForNewTransitions: {
    [transition: string]: Array<SubjectTo>;
  } = {};

  solutionToSkip: any;

  constructor(
    private glpk: GLPK,
    private partialOrders: Array<PartialOrder>,
    private petriNet: PetriNet,
    private idToTransitionLabelMap: { [id: string]: string }
  ) {
    this.directlyFollowsExtractor = new DirectlyFollowsExtractor();
    this.allVariables = new Set<string>();
    this.poVariableNames = new Set<string>();
    this.labelVariableMapIngoing = new Map<string, string>();
    this.labelVariableMapOutgoing = new Map<string, string>();
    this.inverseLabelVariableMapIngoing = new Map<string, string>();
    this.inverseLabelVariableMapOutgoing = new Map<string, string>();

    this.baseIlp = this.setUpBaseIlp();
    this.pairs = this.directlyFollowsExtractor.oneWayDirectlyFollows();
  }

  /**
   * Generates a place for every invalid place in the net.
   * @param placeModel the id of the place to generate a new for
   */
  computeSolutions(
    placeModel: SolutionGeneratorType
  ): Observable<ProblemSolution[]> {
    // Generate place for missing transition
    if (placeModel.type === 'transition') {
      const pairs = this.getPairsForMissingTransition(placeModel.newTransition);
      return combineLatest(
        pairs.map((pair) =>
          this.solveILP(
            this.populateIlpByCausalPairs(
              this.baseIlp,
              pair,
              this.constraintsForNewTransitions[pair[1]]
            )
          ).pipe(map((solution) => solution.solution))
        )
      ).pipe(
        map((solutions) => [
          {
            type: 'multiplePlaces',
            solutions: solutions
              .filter(
                (solution) => solution.result.status !== Solution.NO_SOLUTION
              )
              .map((solution) => solution.result.vars),
            regionSize: Math.max(
              ...solutions.map((solution) =>
                this.generateSumForVars(solution.result.vars)
              )
            ),
          },
        ])
      );
    }

    // Calculate how many tokens are required for current place
    const invalidPlace = this.petriNet.places.find(
      (p) => p.id === placeModel.placeId
    );
    if (placeModel.type === 'warning') {
      const changeMarkingSolution = this.populateIlpBySameWeights(
        this.baseIlp,
        invalidPlace!
      );
      if (!invalidPlace) {
        return of([]);
      }
      console.log("changeMarkingSolution: ");
      console.log(changeMarkingSolution);
      return this.solveILP(changeMarkingSolution).pipe(
        map((solution) => {
          if (solution.solution.result.status === Solution.NO_SOLUTION) {
            return [];
          }
          const problemSolution: ProblemSolution = {
            type: 'changeMarking',
            solutions: [solution.solution.result.vars],
            regionSize: this.generateSumForVars(solution.solution.result.vars),
          };
          return [problemSolution];
        })
      );
    }

    if (placeModel.type === 'possibility') {
      console.log("Possibility solution");
    }

    const unhandledPairs = this.getUnhandledPairs(invalidPlace!);

    return combineLatest(
      unhandledPairs.map((pair) =>
        this.solveILP(this.populateIlpByCausalPairs(this.baseIlp, pair)).pipe(
          switchMap((solution) => {
            if (solution.solution.result.status !== Solution.NO_SOLUTION) {
              return of(solution);
            }
            return this.solveILP(
              this.populateIlpByCausalPairs(
                this.baseIlp,
                pair,
                undefined,
                false
              )
            );
          }),
          map((solution) => ({
            ilp: solution.ilp,
            solution: solution.solution,
            type: 'multiplePlaces' as SolutionType,
          }))
        )
      )
    ).pipe(
      concatMap(
        (
          multiplePlaces: (ProblemSolutionWithoutType & {
            type: SolutionType;
          })[]
        ) => {
          const ilpsToSolve: { type: SolutionType; ilp: LP }[] = [
            {
              type: 'changeMarking' as SolutionType,
              ilp: this.populateIlpBySameWeights(this.baseIlp, invalidPlace!),
            },
            {
              type: 'changeIncoming' as SolutionType,
              ilp: this.populateIlpBySameOutgoingWeights(
                this.baseIlp,
                invalidPlace!
              ),
            },
          ];

          return combineLatest(
            ilpsToSolve.map((ilp) =>
              this.solveILP(ilp.ilp).pipe(
                map((solution) => ({
                  ...solution,
                  type: ilp.type,
                }))
              )
            )
          ).pipe(map((solutions) => [...solutions, ...multiplePlaces]));
        }
      ),
      toArray(),
      map((placeSolutions) => {
        const typeToSolution: {
          [key in SolutionType]: { sum: number; vars: Vars[] };
        } = {
          changeIncoming: { sum: 0, vars: [] },
          multiplePlaces: { sum: 0, vars: [] },
          changeMarking: { sum: 0, vars: [] },
          addPlace: { sum: 0, vars: [] }, // Precision
        };

        placeSolutions.forEach((placeSolution) => {
          placeSolution
            .filter(
              (solution) =>
                solution.solution.result.status !== Solution.NO_SOLUTION
            )
            .forEach((solution) => {
              typeToSolution[solution.type].sum = Math.max(
                typeToSolution[solution.type].sum,
                this.generateSumForVars(solution.solution.result.vars)
              );
              typeToSolution[solution.type].vars.push(
                solution.solution.result.vars
              );
            });
        });

        console.log('Generated solutions', typeToSolution);

        return Object.entries(typeToSolution)
          .filter(([_, solutions]) => solutions.vars.length > 0)
          .sort(([_, first], [__, second]) => first.sum - second.sum)
          .map(([type, solutions]) => ({
            type: type as SolutionType,
            solutions: solutions.vars,
            regionSize: solutions.sum,
          }));
      }),
      map((foundSolutions) =>
        this.filterSolutionsInSpecificOrder(foundSolutions)
      )
    );
  }

  private generateSumForVars(vars: Vars): number {
    return Array.from(this.poVariableNames).reduce(
      (acc, elem) => vars[elem] + acc,
      0
    );
  }

  private filterSolutionsInSpecificOrder(foundSolutions: ProblemSolution[]) {
    return foundSolutions.filter((value, index) => {
      const _value = JSON.stringify(value.solutions);
      return (
        index ===
        foundSolutions.findIndex((obj) => {
          return JSON.stringify(obj.solutions) === _value;
        })
      );
    });
  }

  /**
   * Filters the initial pairs by only returning the relevant pairs for the current place.
   */
  private getUnhandledPairs(
    invalidPlace: Place
  ): Array<[first: string | undefined, second: string]> {
    return invalidPlace.outgoingArcs.flatMap((outgoingArc) => {
      if (invalidPlace.incomingArcs.length === 0) {
        return [
          [undefined, this.idToTransitionLabelMap[outgoingArc.target]] as [
            first: string | undefined,
            second: string
          ],
        ];
      }
      return invalidPlace.incomingArcs.map((incomingArc) => {
        return [
          this.idToTransitionLabelMap[incomingArc.source],
          this.idToTransitionLabelMap[outgoingArc.target],
        ] as [first: string, second: string];
      });
    });
  }

  private getPairsForMissingTransition(
    transitionName: string
  ): Array<[first: string | undefined, second: string]> {
    const pairsThatArentHandled = this.pairs.filter(
      ([_, target]) => transitionName === target
    );
    if (pairsThatArentHandled.length === 0) {
      return [[undefined, transitionName]];
    }
    return pairsThatArentHandled;
  }

  private populateIlpByCausalPairs(
    baseIlp: LP,
    causalPair: [string | undefined, string],
    additionalConstraints?: SubjectTo[],
    firstTry = true
  ): LP {
    const result = Object.assign({}, baseIlp);
    if (additionalConstraints) {
      result.subjectTo = [...result.subjectTo, ...additionalConstraints];
    }

    // We try to find a place without initial marking and with the pair
    // If we don't found a solution we try to find one with marking and different incoming arcs
    if (firstTry && causalPair[0]) {
      console.log("populateIlpByCausalPairs");
      result.subjectTo = result.subjectTo.concat(
        this.equal(this.variable(VariableName.INITIAL_MARKING), 0).constraints
      );

      result.subjectTo = result.subjectTo.concat(
        this.greaterEqualThan(
          this.variable(
            this.transitionVariableName(
              causalPair[0],
              VariableName.INGOING_ARC_WEIGHT_PREFIX
            )
          ),
          1
        ).constraints
      );
    }

    result.subjectTo = result.subjectTo.concat(
      this.greaterEqualThan(
        this.variable(
          this.transitionVariableName(
            causalPair[1],
            VariableName.OUTGOING_ARC_WEIGHT_PREFIX
          )
        ),
        1
      ).constraints
    );

    // This removes split place as repair option:
    /*     result.subjectTo = result.subjectTo.concat(
          this.smallerThan(
            this.variable(
              this.transitionVariableName(
                causalPair[1],
                VariableName.OUTGOING_ARC_WEIGHT_PREFIX
              )
            ),
            0
          ).constraints
        ); */

    return result;
  }

  private solveILP(ilp: LP): Observable<ProblemSolutionWithoutType> {
    const result$ = new ReplaySubject<ProblemSolutionWithoutType>(1);

    const result = this.glpk.solve(ilp, {
      msglev: MessageLevel.ERROR,
    });

    // Hack for testing :/
    const res = result instanceof Promise ? result : Promise.resolve(result);
    res
      .then((solution: Result) => {
        result$.next({ ilp, solution });
        result$.complete();
      })
      .catch((error) => console.error(error));

    return result$.asObservable();
  }

  private buildBasicIlpForPartialOrders(
    partialOrders: Array<PartialOrder>
  ): Array<SubjectTo> {
    const baseIlpConstraints: Array<SubjectTo> = [];
    console.log("buildBasicIlpForPartialOrders");
    for (let i = 0; i < partialOrders.length; i++) {
      console.log("Partial Order: " + i);
      const events = partialOrders[i].events;
      for (const e of events) {
        if (!this.petriNet.transitions.find((t) => e.label === t.label)) {
          this.constraintsForNewTransitions[e.label] = [
            ...this.firingRule(e, i, partialOrders[i]),
            ...this.tokenFlow(e, i),
          ];

        } else {
          baseIlpConstraints.push(...this.firingRule(e, i, partialOrders[i]));
          baseIlpConstraints.push(...this.tokenFlow(e, i));
          // Precision
          /* if (1 > 2) { */

          if (i == 1 && e.id === "a") {
            console.log("buildBasicIlpForPartialOrders inside");
            /* baseIlpConstraints.push(...this.wrongContinuation(e, i, partialOrders[i])); */
            /* } */
          }
        }
      }
      baseIlpConstraints.push(...this.initialMarking(events, i));
    }
    return baseIlpConstraints;
  }

  private setUpBaseIlp(): LP {
    const subjectTo = this.buildBasicIlpForPartialOrders(this.partialOrders);

    const variablesToMinimize = Array.from(this.poVariableNames);
    return {
      name: 'ilp',
      objective: {
        name: 'goal',
        direction: Goal.MINIMUM,
        vars: variablesToMinimize.map((v) => {
          return this.variable(v, 1);
        }),
      },
      subjectTo,
      generals: Array.from(this.allVariables),
    };
  }

  private firingRule(
    event: EventItem,
    i: number,
    partialOrder: PartialOrder
  ): Array<SubjectTo> {
    const variables =
      event.previousEvents.length === 0
        ? [this.variable(this.getStartOfPoEventId(event.id, i))]
        : [];

    for (const pre of event.previousEvents) {
      variables.push(this.variable(this.getPoArcId(pre, event.id, i)));

      const preLabel = partialOrder.events.find((e) => e.id === pre)?.label;
      if (!preLabel) {
        throw Error('Predecessor label not found!');
      }
      this.directlyFollowsExtractor.add(event.label, preLabel);
    }
    variables.push(
      this.variable(
        this.transitionVariableName(
          event.label!,
          VariableName.OUTGOING_ARC_WEIGHT_PREFIX
        ),
        -1
      )
    );
    return this.greaterEqualThan(variables, 0).constraints;
  }

  private tokenFlow(event: EventItem, i: number): Array<SubjectTo> {
    const variables =
      event.previousEvents.length === 0
        ? [this.variable(this.getStartOfPoEventId(event.id, i))]
        : [];

    for (const pre of event.previousEvents) {
      variables.push(this.variable(this.getPoArcId(pre, event.id, i)));
    }
    for (const post of event.nextEvents) {
      variables.push(this.variable(this.getPoArcId(event.id, post, i), -1));
    }
    if (event.nextEvents.length === 0) {
      variables.push(
        this.variable(this.getPoArcId(event.id, this.FINAL_MARKING, i), -1)
      );
    }
    variables.push(
      this.variable(
        this.transitionVariableName(
          event.label!,
          VariableName.OUTGOING_ARC_WEIGHT_PREFIX
        ),
        -1
      )
    );
    variables.push(
      this.variable(
        this.transitionVariableName(
          event.label!,
          VariableName.INGOING_ARC_WEIGHT_PREFIX
        )
      )
    );
    console.log("tokenFlow");
    return this.equal(variables, 0).constraints;
  }

  // New marking will not be greater than the initial marking (Fitness, page 27)
  private initialMarking(
    events: Array<EventItem>,
    i: number
  ): Array<SubjectTo> {
    const variables = events
      .filter((e) => e.previousEvents.length === 0)
      .map((e) => this.variable(this.getStartOfPoEventId(e.id, i), -1));
    variables.push(this.variable(VariableName.INITIAL_MARKING));
    console.log("initialMarking");
    return this.equal(variables, 0).constraints;
  }

  private populateIlpBySameOutgoingWeights(
    baseIlp: LP,
    existingPlace: Place
  ): LP {
    const result = clonedeep(baseIlp);
    if (existingPlace.incomingArcs.length > 0) {
      existingPlace.incomingArcs.forEach((arc) => {
        const transitionLabel = this.idToTransitionLabelMap[arc.source];
        result.subjectTo = result.subjectTo.concat(
          this.greaterEqualThan(
            this.variable(
              this.transitionVariableName(
                transitionLabel,
                VariableName.INGOING_ARC_WEIGHT_PREFIX
              )
            ),
            arc.weight
          ).constraints
        );
      });
    }

    this.addConstraintsForSameOutgoingWeights(existingPlace, result);
    return result;
  }

  private populateIlpBySameWeights(baseIlp: LP, existingPlace: Place): LP {
    const result = clonedeep(baseIlp);
    this.addConstraintsForSameIncomingWeights(existingPlace, result);
    this.addConstraintsForSameOutgoingWeights(existingPlace, result);
    console.log("Constraints: ");
    console.log(this.constraintsForNewTransitions);
    Object.entries(this.constraintsForNewTransitions).forEach(
      ([key, value]) => {
        result.subjectTo = result.subjectTo.concat(
          this.equal(
            this.variable(
              this.transitionVariableName(
                key,
                VariableName.OUTGOING_ARC_WEIGHT_PREFIX
              )
            ),
            0
          ).constraints,
          this.equal(
            this.variable(
              this.transitionVariableName(
                key,
                VariableName.INGOING_ARC_WEIGHT_PREFIX
              )
            ),
            0
          ).constraints,
          ...value
        );
      }
    );
    return result;
  }

  private addConstraintsForSameOutgoingWeights(
    existingPlace: Place,
    result: LP
  ) {
    if (existingPlace.outgoingArcs.length > 0) {
      const handledTransitions = new Set<string>();
      existingPlace.outgoingArcs.forEach((arc) => {
        const transitionLabel = this.idToTransitionLabelMap[arc.target];
        handledTransitions.add(transitionLabel);

        result.subjectTo = result.subjectTo.concat(
          this.equal(
            this.variable(
              this.transitionVariableName(
                transitionLabel,
                VariableName.OUTGOING_ARC_WEIGHT_PREFIX
              )
            ),
            arc.weight
          ).constraints
        );
      });
      result.subjectTo = result.subjectTo.concat(
        this.getRulesForNoOtherArcs(
          Array.from(handledTransitions),
          VariableName.OUTGOING_ARC_WEIGHT_PREFIX
        )
      );
    } else {
      result.subjectTo = result.subjectTo.concat(
        this.getRulesForNoArcs(VariableName.OUTGOING_ARC_WEIGHT_PREFIX)
      );
    }
  }

  private addConstraintsForSameIncomingWeights(
    existingPlace: Place,
    result: LP
  ) {
    if (existingPlace.incomingArcs.length > 0) {
      const handledTransitions = new Set<string>();
      existingPlace.incomingArcs.forEach((arc) => {
        const transitionLabel = this.idToTransitionLabelMap[arc.source];
        handledTransitions.add(transitionLabel);
        console.log("addConstraintsForSameIncomingWeights");
        result.subjectTo = result.subjectTo.concat(
          this.equal(
            this.variable(
              this.transitionVariableName(
                transitionLabel,
                VariableName.INGOING_ARC_WEIGHT_PREFIX
              )
            ),
            arc.weight
          ).constraints
        );
      });
      result.subjectTo = result.subjectTo.concat(
        this.getRulesForNoOtherArcs(
          Array.from(handledTransitions),
          VariableName.INGOING_ARC_WEIGHT_PREFIX
        )
      );
    } else {
      result.subjectTo = result.subjectTo.concat(
        this.getRulesForNoArcs(VariableName.INGOING_ARC_WEIGHT_PREFIX)
      );
    }
  }

  private getRulesForNoArcs(
    variableName:
      | VariableName.OUTGOING_ARC_WEIGHT_PREFIX
      | VariableName.INGOING_ARC_WEIGHT_PREFIX
  ): Array<SubjectTo> {
    console.log("getRulesForNoArcs");
    return this.petriNet.transitions.flatMap(
      (transition) =>
        this.equal(
          this.variable(
            this.transitionVariableName(transition.label, variableName)
          ),
          0
        ).constraints
    );
  }

  private getRulesForNoOtherArcs(
    ignoredTransitions: Array<string>,
    variableName:
      | VariableName.OUTGOING_ARC_WEIGHT_PREFIX
      | VariableName.INGOING_ARC_WEIGHT_PREFIX
  ): Array<SubjectTo> {
    console.log("getRulesForNoOtherArcs");
    return this.petriNet.transitions
      .filter((transition) => !ignoredTransitions.includes(transition.label))
      .flatMap(
        (transition) =>
          this.equal(
            this.variable(
              this.transitionVariableName(transition.label, variableName)
            ),
            0
          ).constraints
      );
  }

  getInverseVariableMapping(variable: string): SolutionVariable | null {
    if (variable === VariableName.INITIAL_MARKING) {
      return {
        label: VariableName.INITIAL_MARKING,
        type: VariableType.INITIAL_MARKING,
      };
    } else if (variable.startsWith(VariableName.OUTGOING_ARC_WEIGHT_PREFIX)) {
      const label = this.inverseLabelVariableMapIngoing.get(variable);
      if (label === undefined) {
        throw new Error(
          `ILP variable '${variable}' could not be resolved to an ingoing transition label!`
        );
      }
      return {
        label,
        type: VariableType.OUTGOING_TRANSITION_WEIGHT,
      };
    } else if (variable.startsWith(VariableName.INGOING_ARC_WEIGHT_PREFIX)) {
      const label = this.inverseLabelVariableMapOutgoing.get(variable);
      if (label === undefined) {
        throw new Error(
          `ILP variable '${variable}' could not be resolved to an outgoing transition label!`
        );
      }
      return {
        label,
        type: VariableType.INCOMING_TRANSITION_WEIGHT,
      };
    }
    return null;
  }

  private getStartOfPoEventId(id: string, i: number) {
    const d = `${i}${this.PO_ARC_SEPARATOR}${VariableName.INITIAL_MARKING}${this.PO_ARC_SEPARATOR}${id}`;
    this.poVariableNames.add(d);
    return d;
  }

  private getPoArcId(
    sourceId: string,
    destinationId: string,
    i: number
  ): string {
    const id = `${i}${this.PO_ARC_SEPARATOR}Arc${this.PO_ARC_SEPARATOR}${sourceId}${this.PO_ARC_SEPARATOR}to${this.PO_ARC_SEPARATOR}${destinationId}`;
    this.poVariableNames.add(id);
    return id;
  }

  /**
   * Gets variable name for transition
   * @param label transition label
   * @param prefix prefix for variable name
   * @protected
   */
  protected transitionVariableName(
    label: string,
    prefix:
      | VariableName.INGOING_ARC_WEIGHT_PREFIX
      | VariableName.OUTGOING_ARC_WEIGHT_PREFIX
  ): string {
    let map, inverseMap;
    if (prefix === VariableName.OUTGOING_ARC_WEIGHT_PREFIX) {
      map = this.labelVariableMapIngoing;
      inverseMap = this.inverseLabelVariableMapIngoing;
    } else {
      map = this.labelVariableMapOutgoing;
      inverseMap = this.inverseLabelVariableMapOutgoing;
    }

    const saved = map.get(label);
    if (saved !== undefined) {
      return saved;
    }

    const name = this.helperVariableName(label, prefix);
    map.set(label, name);
    inverseMap.set(name, label);
    return name;
  }

  protected helperVariableName(label: string, prefix: string): string {
    let helpVariableName;
    do {
      helpVariableName = `${prefix}${this.PO_ARC_SEPARATOR}${label}${this.PO_ARC_SEPARATOR
        }${this.variableCount++}`;
    } while (this.allVariables.has(helpVariableName));
    this.allVariables.add(helpVariableName);
    return helpVariableName;
  }

  // Every event will not give to many tokens to the next arc (Fitness, page 27)
  protected equal(
    variables: Variable | Array<Variable>,
    value: number
  ): ConstraintsWithNewVariables {
    console.debug(`${this.formatVariableList(variables)} = ${value}`);
    return new ConstraintsWithNewVariables(
      this.constrain(arraify(variables), {
        type: Constraint.FIXED_VARIABLE,
        ub: value,
        lb: value,
      })
    );
  }

  // Parse the name and coefficient to a variable called variable (to use it in the glpk.js ILP)
  private variable(name: string, coefficient = 1): Variable {
    return { name, coef: coefficient };
  }

  // Every event will get enough tokens (Fitness, page 27)
  private greaterEqualThan(
    variables: Variable | Array<Variable>,
    lowerBound: number
  ): ConstraintsWithNewVariables {
    console.debug(`${this.formatVariableList(variables)} >= ${lowerBound}`);
    return new ConstraintsWithNewVariables(
      this.constrain(arraify(variables), {
        type: Constraint.LOWER_BOUND,
        ub: 0,
        lb: lowerBound,
      })
    );
  }

  // Add a constraint to use it in the glpk.js ILP
  private constrain(vars: Array<Variable>, bnds: Bound): SubjectTo {
    return {
      name: this.constraintName(),
      vars,
      bnds,
    };
  }

  // Add a contraint name to use it in the glpk.js ILP
  private constraintName(): string {
    return 'c' + this.constraintCount++;
  }

  // Format the list of variables to fit to the glpk.js ILP
  private formatVariableList(variables: Variable | Array<Variable>): string {
    return arraify(variables)
      .map(
        (v) =>
          `${v.coef > 0 ? '+' : ''}${v.coef === -1 ? '-' : v.coef === 1 ? '' : v.coef
          }${v.name}`
      )
      .join(' ');
  }

  // Default term to calculate with smaller than logic (important for precision)
  private smallerThan(
    variables: Variable | Array<Variable>,
    upperBound: number
  ): ConstraintsWithNewVariables {
    console.debug(`${this.formatVariableList(variables)} < ${upperBound}`);
    return new ConstraintsWithNewVariables(
      this.constrain(arraify(variables), {
        type: Constraint.UPPER_BOUND,
        ub: upperBound,
        lb: 0,
      })
    );
  }

  // Logic to take care of wrong continuation restriction already inside the base ilp calculations
  /*   private wrongContinuation(
      event: EventItem,
      i: number,
      partialOrder: PartialOrder
    ): Array<SubjectTo> {
      const variables =
        event.previousEvents.length === 0
          ? [this.variable(this.getStartOfPoEventId(event.id, i))]
          : [];
  
      for (const pre of event.previousEvents) {
        variables.push(this.variable(this.getPoArcId(pre, event.id, i)));
  
        const preLabel = partialOrder.events.find((e) => e.id === pre)?.label;
        if (!preLabel) {
          throw Error('Predecessor label not found!');
        }
        this.directlyFollowsExtractor.add(event.label, preLabel);
      }
      variables.push(
        this.variable(
          this.transitionVariableName(
            "a",//XXX event.label!
            VariableName.INGOING_ARC_WEIGHT_PREFIX
          ),
          +1
        )
      );
      variables.push(
        this.variable(
          this.transitionVariableName(
            "a",//XXX event.label!
            VariableName.OUTGOING_ARC_WEIGHT_PREFIX
          ),
          -1
        )
      );
      variables.push(
        this.variable(
          this.transitionVariableName(
            "c",//XXX event.label!
            VariableName.OUTGOING_ARC_WEIGHT_PREFIX
          ),
          -1
        )
      );
      console.log("Variablen in smallerThan: ");
      console.log(variables);
      return this.smallerThan(variables, 0).constraints;
    } */

  // Avoid wrong continuations, if base ilp is done and solutions should be restricted
  private avoidWrongContinuationIlp(baseIlp: LP, existingPlace: Place, wrongContinuations: string, partialOrders: PartialOrder[]): LP {
    const result = clonedeep(baseIlp);
    /* this.addConstraintsForSameIncomingWeights(existingPlace, result);
    this.addConstraintsForSameOutgoingWeights(existingPlace, result); */
    console.log("existingPlace and wrong continuation: ");
    console.log(existingPlace);
    console.log(wrongContinuations);
    if (wrongContinuations.length > 0) {
      let splitWC = wrongContinuations[0].split(''); //XXX
      /* console.log(arcSplitted[0]);
      console.log(arcSplitted[1]); */

      // Get first
      let firstEntry = splitWC[0];
      let lastEntry = splitWC[splitWC.length - 1];

      const variables = [];
      variables.push(
        this.variable(
          "0_m0_" + firstEntry, // e.g.: 0_m0_a
          +1
        )
      );

      // Handle transitions inbetween
      // Remove the first the last transition
      splitWC.pop();

      for (let i = 0; i < splitWC.length; i++) {
        let transitionBetween = splitWC[i];

        variables.push(
          this.variable(
            this.transitionVariableName(
              transitionBetween, // e.g.: a
              VariableName.INGOING_ARC_WEIGHT_PREFIX
            ),
            +1
          )
        );

        variables.push(
          this.variable(
            this.transitionVariableName(
              transitionBetween, // e.g.: a
              VariableName.OUTGOING_ARC_WEIGHT_PREFIX
            ),
            -1
          )
        );
      }

      // Handle the last entry
      variables.push(
        this.variable(
          this.transitionVariableName(
            lastEntry, // e.g.: c
            VariableName.OUTGOING_ARC_WEIGHT_PREFIX
          ),
          -1
        )
      );

      console.log("Variables in smallerThan: ");
      console.log(variables);
      result.subjectTo = result.subjectTo.concat(
        this.smallerThan(variables, 0).constraints // e.g.: if 3 or greater than different solution
      );

      this.addConstraintsForWrongContinuation(wrongContinuations, partialOrders, result);
      /* result.subjectTo = result.subjectTo.concat(
        this.getRulesForNoOtherArcs(
          Array.from(handledTransitions),
          VariableName.INGOING_ARC_WEIGHT_PREFIX
        )
      ); */
    } else {
      result.subjectTo = result.subjectTo.concat(
        this.getRulesForNoArcs(VariableName.INGOING_ARC_WEIGHT_PREFIX)
      );
    }
    return result;
  }

  // Single variable values to get a specific solution type (add-place)
  private addConstraintsForWrongContinuation(wrongContinuations: string, partialOrders: PartialOrder[], result: LP) {
    let startTransition = wrongContinuations[0].charAt(0);
    let firstNotValidTransition = wrongContinuations[0].charAt(wrongContinuations[0].length - 1);
    let lastValidTransition = "";
    const handledTransitions: string[] = [];
    result.subjectTo = result.subjectTo.concat(
      this.equal(
        this.variable("0_m0_" + startTransition), 0 // arc.weight
      ).constraints
    );

    result.subjectTo = result.subjectTo.concat(
      this.greaterEqualThan(
        this.variable(
          this.transitionVariableName(
            firstNotValidTransition, // out_c_4
            VariableName.OUTGOING_ARC_WEIGHT_PREFIX
          )
        ),
        1
      ).constraints
    );
    handledTransitions.push("out_" + firstNotValidTransition);

    for (let i = 0; i < partialOrders.length; i++) {
      console.log(partialOrders.length);
      console.log(partialOrders[i].events);
      console.log(partialOrders[i]);
      // Search in partialOrders[i].arcs for the firstNotValidTransition and get the source
      let searchObject = partialOrders[i].arcs.find(o => o.target === firstNotValidTransition);
      let searchLabel = searchObject?.source;
      // Search in the partialOrders[i].events for the source and get the label and use it
      let lastValidTransitionObject = partialOrders[i].events.find(event => event.label === searchLabel);
      if (lastValidTransitionObject) {
        lastValidTransition = lastValidTransitionObject.label; //XXX
        console.log(lastValidTransition);
      }
    }

    result.subjectTo = result.subjectTo.concat(
      this.greaterEqualThan(
        this.variable(
          this.transitionVariableName(
            lastValidTransition, // in_b_3
            VariableName.INGOING_ARC_WEIGHT_PREFIX
          )
        ),
        1
      ).constraints
    );
    handledTransitions.push("in_" + lastValidTransition);

    // Set all not set values to 0

    for (let i = 0; i < partialOrders.length; i++) {
      const events = partialOrders[i].events;
      for (const e of events) {
        let transitionLabelIn = "in_" + e.label;
        let transitionLabelOut = "out_" + e.label;

        // "in_" + e.label not in handledTransitions
        if (!handledTransitions.includes(transitionLabelIn)) {
          result.subjectTo = result.subjectTo.concat(
            this.equal(
              this.variable(
                this.transitionVariableName(
                  e.label,
                  VariableName.INGOING_ARC_WEIGHT_PREFIX
                )
              ),
              0
            ).constraints
          );

          handledTransitions.push(transitionLabelIn);
        }
        // "out_" + e.label not in handledTransitions 
        else if (!handledTransitions.includes(transitionLabelOut)) {
          result.subjectTo = result.subjectTo.concat(
            this.equal(
              this.variable(
                this.transitionVariableName(
                  e.label,
                  VariableName.OUTGOING_ARC_WEIGHT_PREFIX
                )
              ),
              0
            ).constraints
          );
          handledTransitions.push(transitionLabelOut);
        }
      }
    }

    /* result.subjectTo = result.subjectTo.concat(
      this.equal(
        this.variable(
          this.transitionVariableName(
            "a", // out_a_0
            VariableName.OUTGOING_ARC_WEIGHT_PREFIX
          )
        ),
        0 // arc.weight
      ).constraints
    );

    result.subjectTo = result.subjectTo.concat(
      this.equal(
        this.variable(
          this.transitionVariableName(
            "a", // in_a_1
            VariableName.INGOING_ARC_WEIGHT_PREFIX
          )
        ),
        0 // arc.weight
      ).constraints
    );

    result.subjectTo = result.subjectTo.concat(
      this.equal(
        this.variable(
          this.transitionVariableName(
            "b", // out_b_2
            VariableName.OUTGOING_ARC_WEIGHT_PREFIX
          )
        ),
        0 // arc.weight
      ).constraints
    );

    result.subjectTo = result.subjectTo.concat(
      this.equal(
        this.variable(
          this.transitionVariableName(
            "c", // in_c_5
            VariableName.INGOING_ARC_WEIGHT_PREFIX
          )
        ),
        0 // arc.weight
      ).constraints
    ); */

    // The result.subjectTo above does the same as:
    /* const variables3 = [];
          variables3.push(
            this.variable(
              "in_c_5",
              +1
            )
          );
          result.subjectTo = result.subjectTo.concat(
            this.equal(variables3, 0).constraints
          ); */
  }

  /**
 * Generates a place for every invalid place in the net.
 * @param placeModel the id of the place to generate a new for
 */
  computePrecisionSolutions(
    placeModel: SolutionGeneratorType, wrongContinuations: any
  ): Observable<ProblemSolution[]> {
    // Generate place for missing transition
    if (placeModel.type === 'transition') {
      const pairs = this.getPairsForMissingTransition(placeModel.newTransition);
      return combineLatest(
        pairs.map((pair) =>
          this.solveILP(
            this.populateIlpByCausalPairs(
              this.baseIlp,
              pair,
              this.constraintsForNewTransitions[pair[1]]
            )
          ).pipe(map((solution) => solution.solution))
        )
      ).pipe(
        map((solutions) => [
          {
            type: 'multiplePlaces',
            solutions: solutions
              .filter(
                (solution) => solution.result.status !== Solution.NO_SOLUTION
              )
              .map((solution) => solution.result.vars),
            regionSize: Math.max(
              ...solutions.map((solution) =>
                this.generateSumForVars(solution.result.vars)
              )
            ),
          },
        ])
      );
    }

    // Calculate how many tokens are required for current place
    const invalidPlace = this.petriNet.places.find(
      (p) => p.id === "p1"//placeModel.placeId //"p1" //XXX
    );
    /*  if (placeModel.type === 'warning') {
       console.log("Model Type warning and execute again populateIlpBySameWeights"); */
    /*       const changeMarkingSolution = this.populateIlpBySameWeights(
            this.baseIlp,
            invalidPlace!
          );
          if (!invalidPlace) {
            return of([]);
          } */

    /*       return this.solveILP(changeMarkingSolution).pipe(
            map((solution) => {
              if (solution.solution.result.status === Solution.NO_SOLUTION) {
                return [];
              }
              const problemSolution: ProblemSolution = {
                type: 'changeMarking',
                solutions: [solution.solution.result.vars],
                regionSize: this.generateSumForVars(solution.solution.result.vars),
              };
              return [problemSolution];
            })
          ); */
    /* } */

    if (placeModel.type === 'possibility') {
      console.log("Possibility solution");
      //const addPlaceSolution = this.populateIlpBySameWeights( // Adding this will show a valid fitness repair solution
      const addPlaceSolution = this.avoidWrongContinuationIlp( // and removing this
        this.baseIlp,
        invalidPlace!,
        wrongContinuations,
        this.partialOrders
      );
      if (!invalidPlace) {
        return of([]);
      }
      console.log("addPlaceSolution:");
      console.log(addPlaceSolution);
      return this.solveILP(addPlaceSolution).pipe(
        map((solution) => {
          if (solution.solution.result.status === Solution.NO_SOLUTION) {
            console.log("Empty solution");
            return [];
          }
          const problemSolution: ProblemSolution = {
            type: 'addPlace',
            solutions: [solution.solution.result.vars],
            regionSize: this.generateSumForVars(solution.solution.result.vars),
          };
          console.log("problemSolution: ");
          console.log(problemSolution);
          this.solutionToSkip = problemSolution;
          return [problemSolution];
        })
      );
    }

    const unhandledPairs = this.getUnhandledPairs(invalidPlace!);

    return combineLatest(
      unhandledPairs.map((pair) =>
        this.solveILP(this.avoidWrongContinuationIlp(this.baseIlp, invalidPlace!, wrongContinuations, this.partialOrders)).pipe( // populateIlpByCausalPairs(this.baseIlp, pair)
          switchMap((solution) => {
            if (solution.solution.result.status !== Solution.NO_SOLUTION) {
              return of(solution);
            }
            return this.solveILP(
              this.populateIlpByCausalPairs(
                this.baseIlp,
                pair,
                undefined,
                false
              )
            );
          }),
          map((solution) => ({
            ilp: solution.ilp,
            solution: solution.solution,
            type: 'multiplePlaces' as SolutionType,
          }))
        )
      )
    ).pipe(
      concatMap(
        (
          multiplePlaces: (ProblemSolutionWithoutType & {
            type: SolutionType;
          })[]
        ) => {
          const ilpsToSolve: { type: SolutionType; ilp: LP }[] = [
            /* {
              type: 'changeMarking' as SolutionType,
              ilp: this.populateIlpBySameWeights(this.baseIlp, invalidPlace!),
            },
            {
              type: 'changeIncoming' as SolutionType,
              ilp: this.populateIlpBySameOutgoingWeights(
                this.baseIlp,
                invalidPlace!
              ),
            } , */
            {
              type: 'addPlace' as SolutionType,
              ilp: this.avoidWrongContinuationIlp( // XXX
                this.baseIlp,
                invalidPlace!,
                wrongContinuations,
                this.partialOrders
              ),
            },
          ];

          return combineLatest(
            ilpsToSolve.map((ilp) =>
              this.solveILP(ilp.ilp).pipe(
                map((solution) => ({
                  ...solution,
                  type: ilp.type,
                }))
              )
            )
          ).pipe(map((solutions) => [...solutions,])); //...multiplePlaces
        }
      ),
      toArray(),
      map((placeSolutions) => {
        const typeToSolution: {
          [key in SolutionType]: { sum: number; vars: Vars[] };
        } = {
          changeIncoming: { sum: 0, vars: [] },
          multiplePlaces: { sum: 0, vars: [] },
          changeMarking: { sum: 0, vars: [] },
          addPlace: { sum: 0, vars: [] }, // Precision
        };

        console.log("placeSolutions :");
        console.log(placeSolutions);
        placeSolutions.forEach((placeSolution) => {
          placeSolution
            .filter(
              (solution) =>
                solution.solution.result.status !== Solution.NO_SOLUTION
            )
            .forEach((solution) => {
              typeToSolution[solution.type].sum = Math.max(
                typeToSolution[solution.type].sum,
                this.generateSumForVars(solution.solution.result.vars)
              );
              typeToSolution[solution.type].vars.push(
                solution.solution.result.vars
              );
            });
        });

        console.log('Generated solutions', typeToSolution);

        return Object.entries(typeToSolution)
          .filter(([_, solutions]) => solutions.vars.length > 0)
          .sort(([_, first], [__, second]) => first.sum - second.sum)
          .map(([type, solutions]) => ({
            type: type as SolutionType,
            solutions: solutions.vars,
            regionSize: solutions.sum,
          }));
      }),
      map((foundSolutions) =>
        this.filterSolutionsInSpecificOrder(foundSolutions)
      )
    );
  }
}
