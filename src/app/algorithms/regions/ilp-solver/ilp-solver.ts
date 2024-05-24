import { GLPK, LP, Result } from 'glpk.js';
import clonedeep from 'lodash.clonedeep';
import { combineLatest, concatMap, map, Observable, of, ReplaySubject, switchMap, toArray, } from 'rxjs';

import { PartialOrder, wrongContinuation } from '../../../classes/diagram/partial-order';
import { PetriNet } from '../../../classes/diagram/petri-net';
import { Place } from '../../../classes/diagram/place';
import { EventItem } from '../../../classes/diagram/transition';
import { arraify } from '../arraify';
import { ConstraintsWithNewVariables } from './constraints-with-new-variables';
import { DirectlyFollowsExtractor } from './directly-follows-extractor';
import { Bound, ProblemSolution, ProblemSolutionWithoutType, SolutionType, SolutionVariable, SubjectTo, Variable, VariableName, VariableType, Vars, } from './solver-classes';
import { Constraint, Goal, MessageLevel, Solution } from './solver-constants';

export type SolutionGeneratorType =
  | {
    type: 'repair' | 'warning' | 'possibility' | 'implicit';
    placeId: string;
    newTransition?: string;
  }
  | {
    type: 'transition';
    newTransition: string;
  }
  | {
    type: 'possibility';
    newTransition: string;
    placeId: string;
  }
  | {
    type: 'implicit';
    newTransition: string;
    placeId: string;
  };

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

    // Take care of the undhandledPairs and combine then the solutions
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
          addPlace: { sum: 0, vars: [] }, // [precision model repair]
          addTrace: { sum: 0, vars: [] }, // [precision model repair]
          removePlace: { sum: 0, vars: [] }, // [precision model repair]
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
        // Sort the solutions. Be aware that these solutions will be combined to a single one in the user interface!
        this.filterSolutionsInSpecificOrder(foundSolutions)
      )
    );
  }

  /**
     * Generate the sum of the variables that are contained in each (sub-)solution
     * @param vars that are the variables of the ilp solution
     * @returns a titak sum of all variables
     */
  private generateSumForVars(vars: Vars): number {
    return Array.from(this.poVariableNames).reduce(
      (acc, elem) => vars[elem] + acc,
      0
    );
  }

  /**
     * Sorts the solutions
     * @param foundSolutions of the ilp
     * @returns foundSolutions in different order (by index)
     */
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
   * @param invalidPlace contains a marking and a issue status
   * @returns the related pairs of this invalid place (found by arc connections)
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

  /**
   * Identify unhandled pairs to get missing transitions
   * @param transitionName is a string like "a"
   * @returns unhandled pairs
   */
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

  /**
   * Generate a constraint to handle causal pairs (special solution category)
   * @param baseIlp 
   * @param causalPair 
   * @param additionalConstraints 
   * @param firstTry 
   * @returns constraint
   */
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
    return result;
  }

  /**
   * Send the constraints to the glpk and get the result
   * @param ilp 
   * @returns result of inequation system
   */
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
      .catch((error) => {
        let solution: Result = {
          "name": "ilp",
          "time": 0.000,
          "result": {
            "vars": {
              "m0": 0
            },
            "z": 0,
            "status": 5
          }
        };
        result$.next(<ProblemSolutionWithoutType>{ ilp, solution });
        result$.complete();
        console.error(error);
      });

    return result$.asObservable();
  }

  /**
   * Build the basic ilp calculation constraints
   * @param partialOrders 
   * @returns constraints
   */
  private buildBasicIlpForPartialOrders(
    partialOrders: Array<PartialOrder>
  ): Array<SubjectTo> {
    const baseIlpConstraints: Array<SubjectTo> = [];

    for (let i = 0; i < partialOrders.length; i++) {

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
        }
      }
      baseIlpConstraints.push(...this.initialMarking(events, i));
    }
    return baseIlpConstraints;
  }

  /**
   * Sets up the base ilp statement including some "settings"
   * @returns ilp object
   */
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

  /**
   * Build the variables and terms for the firing rule
   * @param event 
   * @param i 
   * @param partialOrder 
   * @returns constraint
   */
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

  /**
   * Build the constraints for the tokenFlow (ilp inequation system)
   * @param event 
   * @param i 
   * @returns constraint
   */
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
    return this.equal(variables, 0).constraints;
  }

  /**
   * New marking will not be greater than the initial marking (Fitness, page 27)
   * @param events 
   * @param i 
   * @returns constraint
   */
  private initialMarking(
    events: Array<EventItem>,
    i: number
  ): Array<SubjectTo> {
    const variables = events
      .filter((e) => e.previousEvents.length === 0)
      .map((e) => this.variable(this.getStartOfPoEventId(e.id, i), -1));
    variables.push(this.variable(VariableName.INITIAL_MARKING));
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

  /**
   * Generate a contraint to have the same weights in the solution (special solution category)
   * @param baseIlp 
   * @param existingPlace 
   * @returns constraint
   */
  private populateIlpBySameWeights(baseIlp: LP, existingPlace: Place): LP {
    const result = clonedeep(baseIlp);
    this.addConstraintsForSameIncomingWeights(existingPlace, result);
    this.addConstraintsForSameOutgoingWeights(existingPlace, result);
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

  /**
   * Generate the constraint with same outgoing weights in the solution (special solution category)
   * @param existingPlace 
   * @param result 
   */
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

  /**
   * Add the constraint to have the same incoming weights on the arcs (special solution category)
   * @param existingPlace 
   * @param result 
   */
  private addConstraintsForSameIncomingWeights(
    existingPlace: Place,
    result: LP
  ) {
    if (existingPlace.incomingArcs.length > 0) {
      const handledTransitions = new Set<string>();
      existingPlace.incomingArcs.forEach((arc) => {
        const transitionLabel = this.idToTransitionLabelMap[arc.source];
        handledTransitions.add(transitionLabel);
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

  /**
   * Generate constraint for each element that does not have a variable
   * @param variableName 
   * @returns constraint
   */
  private getRulesForNoArcs(
    variableName:
      | VariableName.OUTGOING_ARC_WEIGHT_PREFIX
      | VariableName.INGOING_ARC_WEIGHT_PREFIX
  ): Array<SubjectTo> {
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

  /**
   * If there are ignoredTransitions, then set these variables to 0
   * @param ignoredTransitions 
   * @param variableName 
   * @returns constraint
   */
  private getRulesForNoOtherArcs(
    ignoredTransitions: Array<string>,
    variableName:
      | VariableName.OUTGOING_ARC_WEIGHT_PREFIX
      | VariableName.INGOING_ARC_WEIGHT_PREFIX
  ): Array<SubjectTo> {
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

  /**
   * Check the variable and map it back to the petri net elements
   * @param variable 
   * @returns petri net labels (events, places)
   */
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
          `ILP variable '${variable}' could not be resolved to an outgoing transition label!`
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
          `ILP variable '${variable}' could not be resolved to an ingoing transition label!`
        );
      }
      return {
        label,
        type: VariableType.INCOMING_TRANSITION_WEIGHT,
      };
    }
    return null;
  }

  /**
   * Generate the initial start variable
   * @param id start transition
   * @param i 
   * @returns variable
   */
  private getStartOfPoEventId(id: string, i: number) {
    const d = `${i}${this.PO_ARC_SEPARATOR}${VariableName.INITIAL_MARKING}${this.PO_ARC_SEPARATOR}${id}`;
    this.poVariableNames.add(d);
    return d;
  }

  /**
   * Generate the arc variable
   * @param sourceId from transition/place
   * @param destinationId to transition/place
   * @param i 
   * @returns variable
   */
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

  /**
   * Every event will not give to many tokens to the next arc (Fitness, page 27)
   * @param variables 
   * @param value 
   * @returns a constraint
   */
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

  /**
   * Parse the name and coefficient to a variable called variable (to use it in the glpk.js ILP)
   */
  private variable(name: string, coefficient = 1): Variable {
    return { name, coef: coefficient };
  }

  /**
   * Every event will get enough tokens (Fitness, page 27)
   * @param variables 
   * @param lowerBound 
   * @returns a constraint
   */
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

  /**
   * Add a constraint to use it in the glpk.js ILP
   * @param vars variables
   * @param bnds boundaries
   * @returns an constraint object
   */
  private constrain(vars: Array<Variable>, bnds: Bound): SubjectTo {
    return {
      name: this.constraintName(),
      vars,
      bnds,
    };
  }

  /**
   * Add a contraint name to use it in the glpk.js ILP
   * @returns a constraint name
   */
  private constraintName(): string {
    return 'c' + this.constraintCount++;
  }

  /**
   * Format the list of variables to fit to the glpk.js ILP
   * @param variables 
   * @returns variables including a coefficient
   */
  private formatVariableList(variables: Variable | Array<Variable>): string {
    return arraify(variables)
      .map(
        (v) =>
          `${v.coef > 0 ? '+' : ''}${v.coef === -1 ? '-' : v.coef === 1 ? '' : v.coef
          }${v.name}`
      )
      .join(' ');
  }

  /**
   * Default term to calculate with smaller than logic (important for precision)
   * @param variables of the ilp calculations
   * @param upperBound means < X in the ilp calculation
   * @returns a constraint that has to be added to the ilp calculations
   */
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

  /**
   * Avoid wrong continuations, if base ilp is done and solutions should be restricted
   * @param baseIlp 
   * @param existingPlace 
   * @param wrongContinuations 
   * @param partialOrders 
   * @param z 
   * @returns 
   */
  private avoidWrongContinuationIlp(baseIlp: LP/* , existingPlace: Place */, wrongContinuations: wrongContinuation[], partialOrders: PartialOrder[], z: number): LP {
    const result = clonedeep(baseIlp);
    if (wrongContinuations.length > 0) {
      let splitWC = wrongContinuations[z].wrongContinuation.split(',');

      // Get first
      let firstEntry = splitWC[0];
      let lastEntry = splitWC[splitWC.length - 1];

      let variables = [];
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

        let variable1 =
          this.variable(
            this.transitionVariableName(
              transitionBetween, // e.g.: a
              VariableName.INGOING_ARC_WEIGHT_PREFIX
            ),
            +1);

        let variable2 =
          this.variable(
            this.transitionVariableName(
              transitionBetween, // e.g.: a
              VariableName.OUTGOING_ARC_WEIGHT_PREFIX
            ),
            -1);

        // Adjust the coeff of the variables, if the variables would be added a second time to the term
        const index = variables.findIndex(variable => variable.name.includes(variable1.name));
        if (index !== -1) {
          variables[index].coef = variables[index].coef + 1;
        } else {
          variables.push(
            this.variable(
              this.transitionVariableName(
                transitionBetween, // e.g.: a
                VariableName.INGOING_ARC_WEIGHT_PREFIX
              ),
              +1
            )
          );
        }

        // Adjust the coeff of the variables, if the variables would be added a second time to the term
        const index2 = variables.findIndex(variable => variable.name.includes(variable2.name));
        if (index2 !== -1) {
          variables[index2].coef = variables[index2].coef - 1;
        } else {
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
      }

      let variable3 =
        this.variable(
          this.transitionVariableName(
            lastEntry, // e.g.: a
            VariableName.OUTGOING_ARC_WEIGHT_PREFIX
          ),
          -1);
      // Handle the last entry
      // Adjust the coeff of the variables, if the variables would be added a second time to the term
      const index3 = variables.findIndex(variable => variable.name.includes(variable3.name));
      if (index3 !== -1) {
        variables[index3].coef = variables[index3].coef - 1;
      } else {
        variables.push(
          this.variable(
            this.transitionVariableName(
              lastEntry, // e.g.: c
              VariableName.OUTGOING_ARC_WEIGHT_PREFIX
            ),
            -1
          )
        );
      }

      result.subjectTo = result.subjectTo.concat(
        this.smallerThan(variables, 0).constraints // e.g.: if 3 or greater than different solution
      );

      this.addConstraintsForWrongContinuation(wrongContinuations, partialOrders, result, z);
    } else {
      result.subjectTo = result.subjectTo.concat(
        this.getRulesForNoArcs(VariableName.INGOING_ARC_WEIGHT_PREFIX)
      );
    }
    return result;
  }

  /**
   * Single variable values to get a specific solution type (add-place)
   * @param wrongContinuations 
   * @param partialOrders 
   * @param result basic linear inequation system
   * @param z index of the currently relevant wrong continuation
   */
  private addConstraintsForWrongContinuation(wrongContinuations: wrongContinuation[], partialOrders: PartialOrder[], result: LP, z: number) {
    let startTransition = wrongContinuations[z].wrongContinuation.charAt(0);
    let firstNotValidTransition = wrongContinuations[z].wrongContinuation.charAt(wrongContinuations[z].wrongContinuation.length - 1);
    let lastValidTransition = "";
    let lastValidWithLoop = "";
    let whileLoop = false;
    if (wrongContinuations[z].wrongContinuation.charAt(wrongContinuations[z].wrongContinuation.length - 3) == wrongContinuations[z].wrongContinuation.charAt(wrongContinuations[z].wrongContinuation.length - 2)) {
      whileLoop = true;
    }
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
      // Search in partialOrders[i].arcs for the firstNotValidTransition and get the source
      let searchObject = partialOrders[i].arcs.find(o => o.target === firstNotValidTransition);
      let searchLabel = searchObject?.source;
      // Search in the partialOrders[i].events for the source and get the label and use it
      let lastValidTransitionObject = partialOrders[i].events.find(event => event.label === searchLabel);
      if (lastValidTransitionObject) {
        lastValidTransition = lastValidTransitionObject.label;
        lastValidWithLoop = lastValidTransition;
        while (lastValidTransition === searchLabel && whileLoop == true) {
          whileLoop = true;
          searchObject = partialOrders[i].arcs.find(o => o.target === searchLabel);
          searchLabel = searchObject?.source;
          lastValidTransitionObject = partialOrders[i].events.find(event => event.label === searchLabel);
          if (lastValidTransitionObject) {
            lastValidTransition = lastValidTransitionObject.label;
          }
        }
      }
    }

    if (whileLoop == true) {
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
    } else {
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
    }

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
  }

  /**
  * This will add restriction to the ilp so that  a net without the specific place that is implicit is generated
  * @param baseIlp 
  * @param existingPlace 
  * @param partialOrders 
  * @returns 
  */
  private implicitPlacesIlp(baseIlp: LP, existingPlace: Place, partialOrders: PartialOrder[]): LP {
    const result = clonedeep(baseIlp);
    const handledTransitions: string[] = [];

    for (let i = 0; i < partialOrders.length; i++) {
      const events = partialOrders[i].events;
      for (const e of events) {
        let transitionLabelIn = "in_" + e.label;
        let transitionLabelOut = "out_" + e.label;

        // "in_" + e.label not in handledTransitions
        if (!handledTransitions.includes(transitionLabelIn)) {
          result.subjectTo = result.subjectTo.concat(
            this.greaterEqualThan(
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
            this.greaterEqualThan(
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

    return result;
  }

  /**
  * Generates a place for every invalid transition in the net.
  * @param placeModel the id of the place to generate a new for
  */
  calculatePrecisionSolutions(
    placeModel: SolutionGeneratorType, wrongContinuations: wrongContinuation[]
  ): Observable<ProblemSolution[]> {
    if (placeModel.type === 'implicit') {
      const implicitPlace = this.petriNet.places.find(
        (p) => p.id === placeModel.placeId
      );
      const removePlaceSolution = this.implicitPlacesIlp(
        this.baseIlp,
        implicitPlace!,
        this.partialOrders,
      );

      return this.solveILP(removePlaceSolution).pipe(
        map((solution) => {
          if (solution.solution.result.status === Solution.NO_SOLUTION) {
            return [];
          }
          let problemSolution: ProblemSolution = {
            type: 'removePlace',
            solutions: [solution.solution.result.vars],
            regionSize: this.generateSumForVars(solution.solution.result.vars),
          };

          if (problemSolution.regionSize == 0) {

            problemSolution = {
              type: 'removePlace',
              solutions: [solution.solution.result.vars],
              regionSize: 0,
            };
          }
          return [problemSolution];
        })
      );
    }

    let z = 0;
    if (placeModel.type === 'possibility') {
      z = wrongContinuations.findIndex((invalidTransition: { firstInvalidTransition: string | string[]; }) => invalidTransition.firstInvalidTransition.includes(placeModel.placeId));
    }
    let addPlaceSolution: any;
    if (placeModel.type === 'possibility') {
      if (wrongContinuations[z].wrongContinuation) {
        addPlaceSolution = this.avoidWrongContinuationIlp(
          this.baseIlp,
          wrongContinuations,
          this.partialOrders,
          z
        );
      } else {
        let implicitPlace: Place = {
          "id": "",
          "type": "place",
          "marking": 0,
          "incomingArcs": [
            {
              "weight": 1,
              "source": "a",
              "target": "p1",
              "breakpoints": []
            }
          ],
          "outgoingArcs": [
            {
              "weight": 1,
              "source": "p1",
              "target": "b",
              "breakpoints": []
            },
            {
              "weight": 1,
              "source": "p1",
              "target": "c",
              "breakpoints": []
            }
          ],
          "issueStatus": "possibility"
        };

        addPlaceSolution = this.implicitPlacesIlp(
          this.baseIlp,
          implicitPlace!,
          this.partialOrders,
        );
      }

      return this.solveILP(addPlaceSolution).pipe(
        map((solution) => {
          if (solution.solution.result.status === Solution.NO_SOLUTION) {
            return [];
          }
          let problemSolution: ProblemSolution = {
            type: 'addPlace',
            solutions: [solution.solution.result.vars],
            regionSize: this.generateSumForVars(solution.solution.result.vars),
          };

          return [problemSolution];
        })
      );
    } else {
      return combineLatest(
        this.solveILP(this.baseIlp).pipe(
          switchMap((solution) => {
            if (solution.solution.result.status !== Solution.NO_SOLUTION) {
              return of(solution);
            }
            return [];
          }),
          map((solution) => ({
            ilp: solution.ilp,
            solution: solution.solution,
            type: 'multiplePlaces' as SolutionType,
          }))
        )
      ).pipe(
        concatMap(
          (
            multiplePlaces: (ProblemSolutionWithoutType & {
              type: SolutionType;
            })[]
          ) => {
            // If we handle the iteration here, then the solutions will be combined into one solution per type. If we handle the iteration higher, then it will not work, 
            // because the response is different and cant be handled in parse-solutionfile line 302
            let ilpsToSolve: { type: SolutionType; ilp: LP }[] = [
              {
                type: 'addPlace' as SolutionType,
                ilp: this.avoidWrongContinuationIlp(
                  this.baseIlp,
                  wrongContinuations,
                  this.partialOrders,
                  z
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
            ).pipe(map((solutions) => [...solutions,]));
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
            addPlace: { sum: 0, vars: [] }, // [precision model repair]
            addTrace: { sum: 0, vars: [] }, // [precision model repair]
            removePlace: { sum: 0, vars: [] }, // [precision model repair]
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

                if (solution.type === "addTrace") {
                  typeToSolution[solution.type].sum = 0;
                }

                typeToSolution[solution.type].vars.push(
                  solution.solution.result.vars
                );
              });
          });

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
}
