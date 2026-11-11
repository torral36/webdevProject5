// Intro To WebDev Prof R

/*
 * APPLICATION OVERVIEW
 * ---------------------------------------------------------
 * 1. HTML provides a file selector and a canvas element.
 * 2. CSS sizes the canvas so it fills the browser window.
 * 3. BabylonJS creates a scene, camera, and light source.
 * 4. The user selects one or more GLB model files.
 * 5. JavaScript imports each model into the scene.
 * 6. Each model is scaled and positioned automatically.
 * 7. BabylonJS continuously renders the scene in the canvas.
 * ---------------------------------------------------------
 */

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
const fileInput = document.getElementById("glbFileInput");

let scene;            // global
let modelCount = 0;
const spacing = 10;

// ADDED: multi-user state --------------------------------------------
const roleLabel = document.getElementById("roleLabel");
let myRole = null;                  // "host" or "spectator", assigned by the server
let latestState = { models: [] };   // most recent scene state received from the server
const loadedIds = new Set();        // ids of models this client has already loaded
let loadChain = Promise.resolve();  // makes models load one at a time, in order
fileInput.style.display = "none";   // hidden until the server says we are the host
// Connect back to whichever server served this page
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
// END ADDED ----------------------------------------------------------

const createScene = async () => {
    const scene = new BABYLON.Scene(engine); // local to function

    let yaw = 0.0;
    let pitch = toRadians(90.0);    // 90 degs at horizon, 0 looking up, 120 looking 30degs down
    // https://doc.babylonjs.com/typedoc/classes/BABYLON.ArcRotateCamera
    // Add a default camera
    //                                                             distance      target
    const camera = new BABYLON.ArcRotateCamera("camera", yaw, pitch, 15, new BABYLON.Vector3(0, 0, 0), scene);
    camera.attachControl(canvas, true);

    // Add lighting
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    return scene;
};
// End of createScene


function toRadians(degrees) {
    return degrees * Math.PI / 180.0;
}

//https://www.w3schools.com/js/js_function_iife.asp
// An Immediately Invoked Function Expression (IIFE)
(async () => {scene = await createScene();})(); // Execute anonymous aync function

// CHANGED: this used to be the file input's change handler. It is now a function so that
// every client (host AND spectators) can run it when the server announces a model.
// "file" is now the .glb file NAME (a string, loaded from the server's public folder)
// and xPos now comes from the shared scene state.
async function loadGlb(file, xPos) {
    if (!file || !scene) {
        return;
    }
    console.log(file);
    try {
        /*
         * MODEL LOADING WORKFLOW
         * ------------------------------------------------
         * 1. User selects a GLB file from the file picker.
         * 2. BabylonJS imports the model into the scene.
         * 3. The model is automatically scaled to a
         *    consistent size.
         * 4. The model's center point is calculated.
         * 5. The model is positioned beside previously
         *    loaded models.
         * 6. The render loop displays the updated scene.
         * ------------------------------------------------
         */

        // https://doc.babylonjs.com/typedoc/functions/BABYLON.ImportMeshAsync
        const result = await 
            BABYLON.SceneLoader.ImportMeshAsync(
                "",      // import all meshes
                "",      // no separate directory path
                file,    // The selected file browser
                scene,   // Desitination Babylon.js scene
                null,    // No progress callback
                ".glb"); // Use glb loader

        if (result.meshes && result.meshes.length > 0) {   // Verify that one or more meshes were imported
            const rootMesh = result.meshes[0];             // Use the first mesh as the root mesh
            const bounds = rootMesh.getHierarchyBoundingVectors(); // Obtain bounding box information for the model
            const size = bounds.max.subtract(bounds.min);  // Calculate the model dimensions
            const largestDimension = Math.max(size.x, size.y, size.z); // Find the largest dimension
            const scale = 5 / largestDimension;            // Calculate a scaling factor for consistent model size
            
            rootMesh.scaling = new BABYLON.Vector3(scale, scale, scale);
            const scaledBounds = rootMesh.getHierarchyBoundingVectors();  
            const scaledSize = scaledBounds.max.subtract(scaledBounds.min);
            const center = scaledBounds.min.add(scaledSize.scale(0.5));

            // (the xPos calculation moved to getXPosForIndex() below so the host can send it)

            modelCount++;  // Increase the count of loaded models
            rootMesh.position = new BABYLON.Vector3(xPos - center.x, -center.y, -center.z);
            console.log(
                `Model ${modelCount} loaded at x = ${xPos}`
            );
        }

    } catch (error) {                    // Handle any loading errors        
        console.error(                   // Display error information in the console
            "Error loading GLB file:",   // Error message
            error                        // Error object
        );
    }
}
// End of loadGlb

// ADDED: multi-user code ---------------------------------------------

// Your original x-position formula, moved here unchanged (just parameterized by index)
function getXPosForIndex(index) {
    let xPos;
    if (index === 0) {
        xPos = 0;
    } else {
        const step = Math.ceil(index / 2);
        if (index % 2 === 1) {
            xPos = -step * spacing;
        } else {
            xPos = step * spacing;
        }
    }
    return xPos;
}

// The file picker now only tells the SERVER which model to add. Nothing is loaded
// locally here: the model shows up when the server broadcasts the new state back.
fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file || myRole !== "host") {
        event.target.value = "";
        return;
    }
    const index = latestState.models.length;      // id = index into the models array
    ws.send(JSON.stringify({
        type: "loadModel",
        id: index,
        fileName: file.name,                      // only the NAME is shared; the .glb must be in public/
        position: { x: getXPosForIndex(index), y: 0, z: 0 }
    }));
    event.target.value = "";                      // lets the host pick the same file again
});

// Messages from the server
ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "role") {
        myRole = data.role;
        roleLabel.textContent = "Role: " + myRole;
        fileInput.style.display = (myRole === "host") ? "" : "none";
    }

    if (data.type === "state") {
        latestState = data.sceneState;
        latestState.models.forEach((model) => {
            if (loadedIds.has(model.id)) {
                return;                           // already loaded on this client
            }
            loadedIds.add(model.id);
            loadChain = loadChain.then(async () => {
                while (!scene) {                  // wait until createScene() has finished
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                await loadGlb(model.fileName, model.position.x);
            });
        });
    }
});

ws.addEventListener("close", () => {
    roleLabel.textContent = "Disconnected from server";
});
// END ADDED ----------------------------------------------------------

// Run the engine
engine.runRenderLoop(() => {    // Start BabylonJS's continuous render loop
    if (scene) {                // Start BabylonJS's continuous render loop
        scene.render();         // Render one frame of the scene
    }
});

// Resize the engine on window resize
window.addEventListener("resize", () => {   // Execute when the browser window changes size
    engine.resize();                        // Resize the rendering engine to match the canvas
});
