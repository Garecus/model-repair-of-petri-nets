/**
   * Petri net example
   */
export const examplePetriNet = `.type pn
.transitions
a a
b b
c c
d d
e e
f f
.places
p1 2
p2 0
p3 1
p4 2
p5 1
p6 0
p7 1
.arcs
p1 a
a p2
p2 c
c p5
p5 a
p2 b
b p3
p3 d
d p7
p7 d
p7 c
c p7
d p6
c p4
p4 e 3
e p6
p6 f 3
`;
