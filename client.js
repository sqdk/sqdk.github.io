import * as THREE from '/build/three.module.js';
import '/build/cannon.module.js';
import { DronePIDController, PropellerConfiguration } from './controller.js';
import { Drone } from './drone.js';
import { Line3 } from '/build/three.module.js';
const animate = (renderer, scene, camera, world, drones) => {
    const animator = () => {
        requestAnimationFrame(animator);
        updatePhysics(world, drones);
        camera.position.x = drones[0].body.position.x;
        camera.position.y = drones[0].body.position.y + .5;
        camera.position.z = drones[0].body.position.z + 2;
        render(renderer, scene, camera);
    };
    animator();
};
function initCannon() {
    const world = new CANNON.World();
    world.gravity.set(0, -9.8, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 100;
    return world;
}
function initThree() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 100);
    camera.position.z = 1.8;
    camera.position.y = 0.75;
    camera.quaternion.x = -0.2;
    scene.add(camera);
    const heightGraph = new Line3();
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', onWindowResize, false);
    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        render(renderer, scene, camera);
    }
    return [scene, camera, renderer];
}
function addWorldPlane(world, scene) {
    const plane = new CANNON.Vec3(50, 1, 50);
    const shape = new CANNON.Box(plane);
    const rotation = new CANNON.Quaternion(0, 0, 1, 0);
    const position = new CANNON.Vec3(0, 0, 0);
    const body = new CANNON.Body({
        mass: 0,
        position: position,
        quaternion: rotation
    });
    body.addShape(shape);
    world.addBody(body);
    const geometry = new THREE.BoxGeometry(plane.x, plane.y, plane.z);
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframeLinewidth: 0.5, wireframe: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.quaternion.copy(rotation);
    mesh.position.copy(position);
    mesh.scale.set(2, 2, 2);
    scene.add(mesh);
    return [mesh, body];
}
function addDrone(world, scene, initialPosition) {
    const dynamicController = new DronePIDController(PropellerConfiguration.QuadCross, 8, 1, 12, 1, 1, 8, 1 / 60);
    const stableController = new DronePIDController(PropellerConfiguration.QuadCross, 8, 8, 24, 1, 1, 8, 1 / 60);
    const drone = new Drone(world, scene, initialPosition, [100, 100, 100, 100], 25, 0, dynamicController, PropellerConfiguration.QuadCross);
    return drone;
}
function updatePhysics(world, drones) {
    const timeStep = 1 / 60;
    // Step the physics world
    world.step(timeStep);
    for (let i = 0; i < drones.length; i++) {
        const drone = drones[i];
        // Copy coordinates from Cannon.js to Three.js
        drone.droneFrame.position.x = drone.body.position.x;
        drone.droneFrame.position.y = drone.body.position.y;
        drone.droneFrame.position.z = drone.body.position.z;
        drone.droneFrame.quaternion.w = drone.body.quaternion.w;
        drone.droneFrame.quaternion.x = drone.body.quaternion.x;
        drone.droneFrame.quaternion.y = drone.body.quaternion.y;
        drone.droneFrame.quaternion.z = drone.body.quaternion.z;
        drone.update();
    }
}
function render(renderer, scene, camera) {
    renderer.render(scene, camera);
}
const [scene, camera, renderer] = initThree();
const world = initCannon();
const droneBody = addDrone(world, scene, new CANNON.Vec3(0, 1, 0));
const worldPlane = addWorldPlane(world, scene);
const setParameters = () => {
    console.log({ altitude: altitudeInput.value / 100, forwardSpeed: forawrdSpeedInput.value, sidewaysSpeed: rightSpeedInput.value });
    droneBody.controller.SetParameters({ altitude: altitudeInput.value / 100, forwardSpeed: forawrdSpeedInput.value, sidewaysSpeed: rightSpeedInput.value });
};
const altitudeInput = document.getElementById('altitude');
altitudeInput.onchange = setParameters;
const forawrdSpeedInput = document.getElementById('forward-speed');
forawrdSpeedInput.onchange = setParameters;
const rightSpeedInput = document.getElementById('right-speed');
rightSpeedInput.onchange = setParameters;
setParameters();
animate(renderer, scene, camera, world, [droneBody]);
