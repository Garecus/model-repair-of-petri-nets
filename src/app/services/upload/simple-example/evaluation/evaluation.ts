export const andLog = `.type log
.attributes
case-id
concept:name
.events
1 a
1 b
1 c
2 a
2 c
2 b`;

export const andPetriNet = `.type pn
.transitions
a a
b b
c c
.places
p0 1
p1 0
.arcs
p0 a
a p1
p1 b
p1 c`;

export const loopLog = `.type log
.attributes
case-id
concept:name
.events
1 a
1 b
1 b
1 b
1 c
2 a
2 b
2 c`;

export const loopPetriNet = `.type pn
.transitions
a a
b b
c c
.places
p0 1
p1 0
.arcs
p0 a
a p1
p1 b
p1 c`;

export const skipLog = `.type log
.attributes
case-id
concept:name
.events
1 a
1 b
1 c
2 a
2 c`;

export const skipNet = `.type pn
.transitions
a a
b b
c c
.places
p0 1
p1 0
p2 0
.arcs
p0 a
a p1
p1 b
b p2
p2 c`;

export const repairExampleLog = `.type log
.attributes
case-id
event-id
concept:name
follows[]
.events
1 t0 Register []
1 t1 Analyze_Defect [t0]
1 t2 Repair_(Complex) [t1]
1 t3 Test_Repair [t2]
1 t4 Inform_User [t1]
1 t5 Archive_Repair [t4,t3]
2 t0 Register []
2 t1 Analyze_Defect [t0]
2 t2 Repair_(Simple) [t1]
2 t3 Test_Repair [t2]
2 t4 Inform_User [t1]
2 t5 Archive_Repair [t4,t3]
3 t0 Register []
3 t1 Analyze_Defect [t0]
3 t2 Repair_(Simple) [t1]
3 t3 Test_Repair [t2]
3 t4 Restart_Repair [t3]
3 t5 Inform_User [t1]
3 t6 Repair_(Simple) [t4]
3 t7 Test_Repair [t6]
3 t8 Archive_Repair [t7,t5]
4 t0 Register []
4 t1 Analyze_Defect [t0]
4 t2 Repair_(Simple) [t1]
4 t3 Inform_User [t1]
4 t4 Test_Repair [t2]
4 t5 Restart_Repair [t4]
4 t6 Repair_(Simple) [t5]
4 t7 Test_Repair [t6]
4 t8 Restart_Repair [t7]
4 t9 Repair_(Simple) [t8]
4 t10 Test_Repair [t9]
4 t11 Archive_Repair [t10,t3]
5 t0 Register []
5 t1 Analyze_Defect [t0]
5 t2 Repair_(Complex) [t1]
5 t3 Test_Repair [t2]
5 t4 Inform_User [t1]
5 t5 Restart_Repair [t3]
5 t6 Repair_(Complex) [t5]
5 t7 Test_Repair [t6]
5 t8 Archive_Repair [t7,t4]
6 t0 Register []
6 t1 Analyze_Defect [t0]
6 t2 Repair_(Simple) [t1]
6 t3 Test_Repair [t2]
6 t4 Restart_Repair [t3]
6 t5 Inform_User [t1]
6 t6 Repair_(Complex) [t4]
6 t7 Test_Repair [t6]
6 t8 Archive_Repair [t7,t5]
7 t0 Register []
7 t1 Analyze_Defect [t0]
7 t2 Repair_(Complex) [t1]
7 t3 Test_Repair [t2]
7 t4 Inform_User [t1]
7 t5 Restart_Repair [t3]
7 t6 Repair_(Complex) [t5]
7 t7 Test_Repair [t6]
7 t8 Restart_Repair [t7]
7 t9 Repair_(Complex) [t8]
7 t10 Test_Repair [t9]
7 t11 Archive_Repair [t10,t4]
8 t0 Register []
8 t1 Analyze_Defect [t0]
8 t2 Repair_(Simple) [t1]
8 t3 Test_Repair [t2]
8 t4 Inform_User [t1]
8 t5 Restart_Repair [t3]
8 t6 Repair_(Simple) [t5]
8 t7 Test_Repair [t6]
8 t8 Restart_Repair [t7]
8 t9 Repair_(Complex) [t8]
8 t10 Test_Repair [t9]
8 t11 Archive_Repair [t10,t4]
9 t0 Register []
9 t1 Analyze_Defect [t0]
9 t2 Inform_User [t1]
9 t3 Repair_(Complex) [t1]
9 t4 Test_Repair [t3]
9 t5 Restart_Repair [t4]
9 t6 Repair_(Complex) [t5]
9 t7 Test_Repair [t6]
9 t8 Restart_Repair [t7]
9 t9 Repair_(Complex) [t8]
9 t10 Test_Repair [t9]
9 t11 Restart_Repair [t10]
9 t12 Repair_(Complex) [t11]
9 t13 Test_Repair [t12]
9 t14 Archive_Repair [t13,t2]
10 t0 Register []
10 t1 Analyze_Defect [t0]
10 t2 Repair_(Simple) [t1]
10 t3 Test_Repair [t2]
10 t4 Restart_Repair [t3]
10 t5 Repair_(Simple) [t4]
10 t6 Test_Repair [t5]
10 t7 Restart_Repair [t6]
10 t8 Inform_User [t1]
10 t9 Repair_(Simple) [t7]
10 t10 Test_Repair [t9]
`;

export const repairExampleNet = `.type pn
.transitions
Register Register
Analyze_Defect Analyze_Defect
Inform_User Inform_User
Repair_(Complex) Repair_(Complex)
Test_Repair Test_Repair
Archive_Repair Archive_Repair
Repair_(Simple) Repair_(Simple)
Restart_Repair Restart_Repair
.places
p0 1
p1 0
p2 0
p3 0
p4 0
p5 0
p6 0
p7 0
p8 0
.arcs
p0 Register
Archive_Repair p1
Register p2
p2 Analyze_Defect
Analyze_Defect p3
p3 Inform_User
Test_Repair p4
p4 Archive_Repair
p4 Restart_Repair
Repair_(Complex) p5
p5 Test_Repair
Repair_(Simple) p5
Analyze_Defect p6
p6 Repair_(Complex)
p6 Repair_(Simple)
Restart_Repair p6
Analyze_Defect p7
p7 Restart_Repair
Inform_User p8
p8 Archive_Repair
`;

export const coffeeMachineLog = `.type log
.attributes
case-id
concept:name
event-id
follows[]
.events
1 Kaffeebohnen_mahlen km []
1 Kaffeemaschine_entriegeln ke []
1 Wasser_mit_Glaskanne_holen wgh []
1 Filter_leeren fl [ke]
1 Filter_füllen ff [km, fl]
1 Wasser_einfüllen we [wgh, ke]
1 Kaffeekanne_auswaschen ka [ke]
1 Zusammensetzen_und_starten e [ka, we, ff]
2 Kaffeebohnen_mahlen km []
2 Kaffeemaschine_entriegeln ke []
2 Filter_leeren fl [ke]
2 Filter_füllen ff [km, fl]
2 Kaffeekanne_auswaschen ka [ke]
2 Wasser_mit_Kaffeekanne_holen wkh [ka]
2 Wasser_einfüllen we [wkh]
2 Zusammensetzen_und_starten e [we, ff]`;

export const coffeeMachineNet = `.type pn
.transitions
km Kaffeebohnen_mahlen
ff Filter_füllen
fl Filter_leeren
ke Kaffeemaschine_entriegeln
ka Kaffeekanne_auswaschen
wkh Wasser_mit_Kaffeekanne_holen
wgh Wasser_mit_Glaskanne_holen
we Wasser_einfüllen
e Zusammensetzen_und_starten
.places
p0 1
p1 1
p3 0
p4 0
p5 0
p6 0
p7 0
p8 0
p9 0
p10 0
p11 0
.arcs
p0 km
km p3
p3 ff
ff p4
p4 e
p1 ke
ke p5
p5 fl
fl p6
p6 ff
ke p7
p7 ka
ka p8
p8 e
ka p9
p9 wkh
wkh p10
p10 we
we p11
p11 e
p9 wgh
wgh p10`;