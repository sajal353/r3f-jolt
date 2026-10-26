import { readFileSync } from "node:fs";
import { AnimationMixer, SkinnedMesh, type AnimationClip, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** The demo's mannequin: one 65-bone skeleton shared by two skinned meshes. */
export const loadMannequin = async () => {
  const file = readFileSync("demo/public/models/mannequin/mannequin.glb");
  // Copied into this realm's ArrayBuffer: GLTFLoader recognises a binary file
  // with `instanceof ArrayBuffer`, which Node's own buffer fails under jsdom.
  const buffer = new ArrayBuffer(file.byteLength);
  new Uint8Array(buffer).set(file);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");

  const meshes: SkinnedMesh[] = [];
  gltf.scene.traverse((node) => {
    if (node instanceof SkinnedMesh) meshes.push(node);
  });
  gltf.scene.updateMatrixWorld(true);

  return { scene: gltf.scene, mesh: meshes[0], meshes, animations: gltf.animations };
};

/** A mixer holding `name` at `time`; `timeScale` 0 keeps it there. */
export const playAt = (
  root: Object3D,
  animations: AnimationClip[],
  name: string,
  time: number,
) => {
  const mixer = new AnimationMixer(root);
  const clip = animations.find((each) => each.name === name)!;
  mixer.clipAction(clip).play();
  mixer.setTime(time);
  return mixer;
};
