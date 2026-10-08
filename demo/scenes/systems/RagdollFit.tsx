import { useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Controls, Floor, Hud } from "../../shared/Stage";
import { useMannequin } from "../../shared/mannequin";
import {
  useCharacterModel,
  type UseCharacterModelOptions,
} from "@/Jolt/useCharacterModel";

const CLIPS = [
  "A_TPose",
  "Idle_Loop",
  "Walk_Loop",
  "Sprint_Loop",
  "Jump_Loop",
];

const BOXED: UseCharacterModelOptions["overrides"] = {
  hand_l: { shape: "box" },
  hand_r: { shape: "box" },
  foot_l: { shape: "box" },
  foot_r: { shape: "box" },
};

/**
 * No ragdoll at all: `debug` draws the fitted bodies on the bones themselves,
 * so the fit can be judged against any animation before anything simulates.
 */
const Fitted = ({ boxed }: { boxed: boolean }) => {
  const { character, mixer, play } = useMannequin([0, 0, 0], "Walk_Loop");
  const model = useCharacterModel(character, {
    debug: true,
    overrides: boxed ? BOXED : undefined,
  });
  const [clip, setClip] = useState("Walk_Loop");

  useFrame(function animate(_, delta) {
    mixer.update(delta);
  });

  const choose = (name: string) => {
    play(name);
    setClip(name);
  };

  const logJSON = () => console.log(JSON.stringify(model.toJSON(), null, 2));

  return (
    <>
      <primitive object={character} />

      <Hud position={[0, 2.6, 0]}>
        {model.config.bones.length} bodies · {model.excluded.length} bones ride
        along · {model.config.bones
          .reduce((sum, bone) => sum + bone.mass, 0)
          .toFixed(0)}{" "}
        kg
      </Hud>

      <Controls position={[0, 0.05, 1.4]}>
        {CLIPS.map((name) => (
          <button key={name} onClick={() => choose(name)}>
            {name === clip ? `▸ ${name}` : name}
          </button>
        ))}
        <button onClick={logJSON}>log JSON</button>
      </Controls>
    </>
  );
};

export const RagdollFitScene = () => {
  const [boxed, setBoxed] = useState(false);
  const toggleBoxes = () => setBoxed((value) => !value);

  return (
    <>
      <Floor size={20} />
      {/* The fit is read once; a new key refits with the new overrides. */}
      <Fitted key={String(boxed)} boxed={boxed} />

      <Controls position={[0, 2.2, 0]}>
        <button onClick={toggleBoxes}>
          hands and feet: {boxed ? "box" : "capsule"}
        </button>
      </Controls>
    </>
  );
};
