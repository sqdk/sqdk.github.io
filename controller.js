import { clamp } from "./utils.js";
export class DronePIDController {
    constructor(propellerConfiguration, AltitudeProportional, AltitudeIntegral, AltitudeDerivative, HorizontalTiltProportional, HorizontalTiltIntegral, HorizontalTiltDerivative, deltaT) {
        this.propellerConfiguration = propellerConfiguration;
        this.AltitudeProportional = AltitudeProportional;
        this.AltitudeIntegral = AltitudeIntegral;
        this.AltitudeDerivative = AltitudeDerivative;
        this.HorizontalTiltProportional = HorizontalTiltProportional;
        this.HorizontalTiltIntegral = HorizontalTiltIntegral;
        this.HorizontalTiltDerivative = HorizontalTiltDerivative;
        this.deltaT = deltaT;
        this.Step = (position, velocity, rotation, angularVelocity) => {
            const deltaAltitude = position.y;
            const altitudeCorrection = clamp(this.AltitudeController.update(deltaAltitude), 0, 100);
            const altDisplay = document.getElementById("current-altitude");
            altDisplay.innerHTML = `${position.y - this.AltitudeController.getTarget()} ; ${position.y} ; ${altitudeCorrection}`;
            // FL, FR, BL, BR
            return [
                altitudeCorrection,
                altitudeCorrection,
                altitudeCorrection,
                altitudeCorrection
            ];
        };
        this.SetParameters = (options) => {
            this.AltitudeController.setTarget(options.altitude);
            this.ForwardTiltController.setTarget(options.forwardSpeed / 100);
            this.SidewaysTiltController.setTarget(options.sidewaysSpeed);
        };
        this.AltitudeController = new PIDController(this.AltitudeProportional, this.AltitudeIntegral, this.AltitudeDerivative, this.deltaT, 100);
        this.ForwardTiltController = new PIDController(this.HorizontalTiltProportional, this.HorizontalTiltIntegral, this.HorizontalTiltDerivative, this.deltaT, 100);
        this.SidewaysTiltController = new PIDController(this.HorizontalTiltProportional, this.HorizontalTiltIntegral, this.HorizontalTiltDerivative, this.deltaT, 100);
        this.AltitudeController.setTarget(0);
        this.ForwardTiltController.setTarget(0);
        this.SidewaysTiltController.setTarget(0);
    }
}
export var PropellerConfiguration;
(function (PropellerConfiguration) {
    PropellerConfiguration[PropellerConfiguration["QuadPlus"] = 0] = "QuadPlus";
    PropellerConfiguration[PropellerConfiguration["QuadCross"] = 1] = "QuadCross";
})(PropellerConfiguration || (PropellerConfiguration = {}));
/**
 *  PID Controller.
 */
class PIDController {
    constructor(k_p, k_i, k_d, dt, i_max) {
        this.k_p = k_p;
        this.k_i = k_i;
        this.k_d = k_d;
        this.dt = dt;
        this.i_max = i_max;
        this.sumError = 0;
        this.lastError = 0;
        this.lastTime = 0;
        this.target = 0;
        this.currentValue = 0;
        this.sumError = 0;
        this.lastError = 0;
        this.lastTime = 0;
        this.target = 0; // default value, can be modified with .setTarget
    }
    setTarget(target) {
        this.target = target;
    }
    update(currentValue) {
        this.currentValue = currentValue;
        // Calculate dt
        let dt = this.dt;
        if (!dt) {
            let currentTime = Date.now();
            if (this.lastTime === 0) { // First time update() is called
                dt = 0;
            }
            else {
                dt = (currentTime - this.lastTime) / 1000; // in seconds
            }
            this.lastTime = currentTime;
        }
        if (typeof dt !== 'number' || dt === 0) {
            dt = 1;
        }
        let error = (this.target - this.currentValue);
        this.sumError = this.sumError + error * dt;
        if (this.i_max > 0 && Math.abs(this.sumError) > this.i_max) {
            let sumSign = (this.sumError > 0) ? 1 : -1;
            this.sumError = sumSign * this.i_max;
        }
        let dError = (error - this.lastError) / dt;
        this.lastError = error;
        return (this.k_p * error) + (this.k_i * this.sumError) + (this.k_d * dError);
    }
    reset() {
        this.sumError = 0;
        this.lastError = 0;
        this.lastTime = 0;
    }
    getTarget() {
        return this.target;
    }
}
