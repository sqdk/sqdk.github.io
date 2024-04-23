export class PIDControllerParameters {
    constructor(p, i, d) {
        this.p = p;
        this.i = i;
        this.d = d;
        this.ToString = () => {
            return `PID: ${this.p}-${this.i}-${this.d}`;
        };
    }
}
export class PIDController {
    constructor() {
        this.Step = (prevPos, currPos, prevRot, currRot) => {
        };
    }
}
export var PropellerConfiguration;
(function (PropellerConfiguration) {
    PropellerConfiguration[PropellerConfiguration["QuadPlus"] = 0] = "QuadPlus";
    PropellerConfiguration[PropellerConfiguration["QuadCross"] = 1] = "QuadCross";
})(PropellerConfiguration || (PropellerConfiguration = {}));
