import { clamp } from "./utils.js";
export class DronePIDController {
    constructor(propellerConfiguration, AltitudeProportional, AltitudeIntegral, AltitudeDerivative, RollControllerProportional, RollControllerIntegral, RollControllerDerivative, YawControllerProportional, YawControllerIntegral, YawControllerDerivative, deltaT) {
        this.propellerConfiguration = propellerConfiguration;
        this.AltitudeProportional = AltitudeProportional;
        this.AltitudeIntegral = AltitudeIntegral;
        this.AltitudeDerivative = AltitudeDerivative;
        this.RollControllerProportional = RollControllerProportional;
        this.RollControllerIntegral = RollControllerIntegral;
        this.RollControllerDerivative = RollControllerDerivative;
        this.YawControllerProportional = YawControllerProportional;
        this.YawControllerIntegral = YawControllerIntegral;
        this.YawControllerDerivative = YawControllerDerivative;
        this.deltaT = deltaT;
        this.Step = (position, velocity, rotation, angularVelocity) => {
            const altitudeCorrection = clamp(this.AltitudeController.update(position.y), 0, 100);
            const rollCorrection = clamp(this.RollController.update(rotation.z), -50, 50);
            const pitchCorrection = clamp(this.PitchController.update(rotation.x), -50, 50);
            const yawCorrection = clamp(this.YawController.update(rotation.y), -50, 50);
            const altDisplay = document.getElementById("current-altitude");
            altDisplay.innerHTML = `Target: ${this.AltitudeController.getTarget()} Distance from target: ${(position.y - this.AltitudeController.getTarget()).toFixed(2)} ; Altitude: ${position.y.toFixed(2)} ; Thrust: ${altitudeCorrection.toFixed(2)}`;
            const rollDisplay = document.getElementById("current-roll");
            rollDisplay.innerHTML = `Target: ${this.RollController.getTarget()} Distance from target: ${(rotation.z - this.RollController.getTarget()).toFixed(2)} ; Roll: ${rotation.z.toFixed(2)} ; Thrust: ${rollCorrection}`;
            const pitchDisplay = document.getElementById("current-pitch");
            pitchDisplay.innerHTML = `Target: ${this.PitchController.getTarget()} Distance from target: ${(rotation.x - this.PitchController.getTarget()).toFixed(2)} ; Pitch: ${rotation.x.toFixed(2)} ; Thrust: ${pitchCorrection}`;
            const yawDisplay = document.getElementById("current-yaw");
            yawDisplay.innerHTML = `Target: ${this.YawController.getTarget()} Distance from target: ${(rotation.y - this.YawController.getTarget()).toFixed(2)} ; Yaw: ${rotation.y.toFixed(2)} ; Thrust: ${yawCorrection}`;
            // FL, FR, BR, BL
            const thrustMap = [
                altitudeCorrection - rollCorrection + pitchCorrection - yawCorrection,
                altitudeCorrection + rollCorrection + pitchCorrection + yawCorrection,
                altitudeCorrection + rollCorrection - pitchCorrection - yawCorrection,
                altitudeCorrection - rollCorrection - pitchCorrection + yawCorrection
            ];
            return thrustMap;
        };
        this.SetParameters = (options) => {
            this.AltitudeController.setTarget(options.altitude);
            this.RollController.setTarget(options.roll);
            this.PitchController.setTarget(options.pitch);
            this.YawController.setTarget(options.yaw);
        };
        this.AltitudeController = new PIDController(this.AltitudeProportional, this.AltitudeIntegral, this.AltitudeDerivative, this.deltaT, 100);
        this.RollController = new PIDController(this.RollControllerProportional, this.RollControllerIntegral, this.RollControllerDerivative, this.deltaT, 100);
        this.PitchController = new PIDController(this.RollControllerProportional, this.RollControllerIntegral, this.RollControllerDerivative, this.deltaT, 100);
        this.YawController = new PIDController(this.YawControllerProportional, this.YawControllerIntegral, this.YawControllerDerivative, this.deltaT, 100);
        this.AltitudeController.setTarget(0);
        this.RollController.setTarget(0);
        this.PitchController.setTarget(0);
        this.YawController.setTarget(0);
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
