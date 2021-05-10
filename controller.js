import * as THREE from '/build/three.module.js';
import { clamp } from "./utils.js";
export class DronePIDController {
    constructor(propellerConfiguration, AltitudePIDParams, RollPitchPIDParams, YawPIDParams, deltaT) {
        this.propellerConfiguration = propellerConfiguration;
        this.AltitudePIDParams = AltitudePIDParams;
        this.RollPitchPIDParams = RollPitchPIDParams;
        this.YawPIDParams = YawPIDParams;
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
            if (options.altitude) {
                this.AltitudeController.setTarget(options.altitude);
            }
            if (options.roll) {
                this.RollController.setTarget(options.roll);
            }
            if (options.pitch) {
                this.PitchController.setTarget(options.pitch);
            }
            if (options.yaw) {
                this.YawController.setTarget(options.yaw);
            }
        };
        this.AltitudeController = new PIDController(this.AltitudePIDParams.p, this.AltitudePIDParams.i, this.AltitudePIDParams.d, this.deltaT, 100);
        this.RollController = new PIDController(this.RollPitchPIDParams.p, this.RollPitchPIDParams.i, this.RollPitchPIDParams.d, this.deltaT, 100);
        this.PitchController = new PIDController(this.RollPitchPIDParams.p, this.RollPitchPIDParams.i, this.RollPitchPIDParams.d, this.deltaT, 100);
        this.YawController = new PIDController(this.YawPIDParams.p, this.YawPIDParams.i, this.YawPIDParams.d, this.deltaT, 100);
        this.AltitudeController.setTarget(0);
        this.RollController.setTarget(0);
        this.PitchController.setTarget(0);
        this.YawController.setTarget(0);
    }
}
export class PositionController {
    constructor(DroneController, XYControllerParams, initialTarget, deltaT, sceneRef) {
        this.DroneController = DroneController;
        this.XYControllerParams = XYControllerParams;
        this.deltaT = deltaT;
        this.sceneRef = sceneRef;
        this.Step = (position, velocity, rotation, angularVelocity) => {
            const xDiff = position.x - this.target.x;
            const zDiff = position.z - this.target.z;
            const zCorrection = clamp(this.ZController.update(zDiff) / 100, -0.7, 0.7);
            const xCorrection = clamp(this.XController.update(xDiff) / 100, -0.7, 0.7);
            this.DroneController.SetParameters({
                altitude: this.target.y,
                roll: -xCorrection,
                pitch: zCorrection,
            });
            return this.DroneController.Step(position, velocity, rotation, angularVelocity);
        };
        this.SetParameters = (params) => {
            this.target = new CANNON.Vec3(params.x, params.y, params.z);
            this.targetMesh.position.copy(this.target);
        };
        this.XController = new PIDController(this.XYControllerParams.p, this.XYControllerParams.i, this.XYControllerParams.d, this.deltaT, 100);
        this.ZController = new PIDController(this.XYControllerParams.p, this.XYControllerParams.i, this.XYControllerParams.d, this.deltaT, 100);
        this.target = initialTarget;
        const targetMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const targetGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        this.targetMesh = new THREE.Mesh(targetGeometry, targetMaterial);
        this.targetMesh.position.copy(this.target);
        this.sceneRef.add(this.targetMesh);
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
export class PIDParams {
    constructor(p, i, d) {
        this.p = p;
        this.i = i;
        this.d = d;
    }
}
