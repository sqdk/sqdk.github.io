import * as THREE from './build/three.module.js';
import { PropellerConfiguration } from "./controller.js";
import { clamp } from './utils.js';
export class Drone {
    constructor(world, sceneRef, initialPosition, initialRotation, initialThrust, maxThrust, minThrust, controller, propellerConfiguration = PropellerConfiguration.QuadCross) {
        this.sceneRef = sceneRef;
        this.maxThrust = maxThrust;
        this.minThrust = minThrust;
        this.controller = controller;
        this.propellerConfiguration = propellerConfiguration;
        this.setPropellerThrust = (propellerId, thrust) => {
            // Clamp value between 0 and 100 to translate it to percent
            let clampedThrust = clamp(thrust, 0, 100);
            this.propellerThrust[propellerId] = clampedThrust;
        };
        this.setAllPropellerThrust = (thrust) => {
            thrust.forEach((v, i) => this.setPropellerThrust(i, v));
        };
        this.propellerThrust = initialThrust;
        const frame = new CANNON.Vec3(0.75, 0.02, 0.75);
        const frameShape = new CANNON.Box(frame);
        this.body = new CANNON.Body({
            mass: 2,
            position: initialPosition
        });
        this.body.addShape(frameShape);
        //this.body.quaternion = initialRotation
        this.body.angularDamping = 0.01;
        this.body.linearDamping = 0.01;
        world.addBody(this.body);
        // For some reason, it seems that cannon and three uses different conventions for boxes.
        // If i don't multiply the y axis by 2, the threejs box only covers half of the cannon body
        const frameGeometry = new THREE.BoxGeometry(frame.x, frame.y * 2, frame.z);
        const frameMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
        this.droneFrame = new THREE.Mesh(frameGeometry, frameMaterial);
        this.sceneRef.add(this.droneFrame);
        const h = frameGeometry.parameters.height / 2;
        const d = frameGeometry.parameters.depth / 2;
        const w = frameGeometry.parameters.width / 2;
        if (this.propellerConfiguration === PropellerConfiguration.QuadCross) {
            this.propellerPositions = [
                new THREE.Vector3(-w, h, -d),
                new THREE.Vector3(w, h, -d),
                new THREE.Vector3(w, h, d),
                new THREE.Vector3(-w, h, d),
            ];
        }
        else {
            this.propellerPositions = [
                new THREE.Vector3(0, h, -d),
                new THREE.Vector3(w, h, 0),
                new THREE.Vector3(0, h, d),
                new THREE.Vector3(-w, h, 0),
            ];
        }
        this.propellerMeshes = this.propellerPositions.map((p, i) => {
            const g = new THREE.SphereGeometry(0.01);
            const colors = [
                0xff0000,
                0x00ff00,
                0x0000ff,
                0x00ffff,
                0xffff00,
                0xff00ff,
            ];
            const m = new THREE.MeshBasicMaterial({ color: colors[i], wireframe: true });
            const me = new THREE.Mesh(g, m);
            this.sceneRef.add(me);
            return me;
        });
        this.propellerThrustMeshes = this.propellerPositions.map((p, i) => {
            const g = new THREE.BoxGeometry(0.001, 0.1, 0.001);
            const colors = [
                0xff0000,
                0x00ff00,
                0x0000ff,
                0x00ffff,
                0xffff00,
                0xff00ff,
            ];
            const m = new THREE.MeshBasicMaterial({ color: colors[i], wireframe: true });
            const me = new THREE.Mesh(g, m);
            this.sceneRef.add(me);
            return me;
        });
    }
    update() {
        this.propellerMeshes.forEach((me, i) => {
            const pos = new THREE.Vector3();
            // Vector is now pointing from 0,0 to the propeller position.
            // If the drone was at 0,0, the vector would be pointing directly at the given propeller
            pos.copy(this.propellerPositions[i]);
            // Apply the current (rotation) of the frame to the vector
            pos.applyQuaternion(this.droneFrame.quaternion);
            // Finally, add the position vector of the frame the vector to the final position. Instead of 0,0, the
            // starting point of the vector is now the centerpoint of the drone frame
            pos.add(this.droneFrame.position);
            me.position.copy(pos);
            me.quaternion.copy(this.droneFrame.quaternion);
            this.propellerThrustMeshes[i].position.copy(pos);
            this.propellerThrustMeshes[i].quaternion.copy(this.droneFrame.quaternion);
            this.propellerThrustMeshes[i].scale.copy(new THREE.Vector3(0.1, this.propellerThrust[i], 0.1));
        });
        this.propellerMeshes.forEach((me, i) => {
            const [x, y, z] = [this.propellerPositions[i].x, this.propellerPositions[i].y, this.propellerPositions[i].z];
        });
        this.propellerPositions.forEach((p, i) => {
            const thrustInNewtons = (this.propellerThrust[i] / 100) * this.maxThrust;
            // Apply the upward force from the propellers
            this.body.applyLocalForce(new CANNON.Vec3(0, clamp(thrustInNewtons, this.minThrust, this.maxThrust), 0), new CANNON.Vec3(p.x, p.y, p.z));
            // Apply a sideways force that simulates gyroscopic effects of the propellers and parts of the motors
            // This force allows us to turn sideways
            const sidewaysMultiplier = 0.2;
            const sidewaysForce = clamp(thrustInNewtons, this.minThrust * sidewaysMultiplier, this.maxThrust * sidewaysMultiplier);
            let vector;
            if (i === 0) {
                vector = new CANNON.Vec3(sidewaysForce, 0, 0);
            }
            else if (i === 1) {
                vector = new CANNON.Vec3(-sidewaysForce, 0, 0);
            }
            else if (i === 2) {
                vector = new CANNON.Vec3(-sidewaysForce, 0, 0);
            }
            else if (i === 3) {
                vector = new CANNON.Vec3(sidewaysForce, 0, 0);
            }
            this.body.applyLocalForce(vector, new CANNON.Vec3(p.x, p.y, p.z));
        });
    }
}
