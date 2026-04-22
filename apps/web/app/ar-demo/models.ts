// Registry of models available under /public for the demo page.
// Add entries here as you drop new .glb files into apps/web/public.
export interface DemoModel {
  id: string;
  label: string;
  url: string;
  animated: boolean;
  // Optional hint for pickAnimation (e.g. an existing animation name).
  animationHint?: string;
  // Rough grouping for UI.
  group: "letters" | "animals";
}

const letterEntries: DemoModel[] = [
  { id: "A", label: "A", url: "/Letter_A.glb", animated: false, group: "letters" },
  { id: "B", label: "B", url: "/Letter_B.glb", animated: false, group: "letters" },
  { id: "C", label: "C", url: "/Letter_C.glb", animated: false, group: "letters" },
  ..."DEFGHIJKLMNOPQRSTUVWXYZ".split("").map<DemoModel>((ch) => ({
    id: ch,
    label: ch,
    url: `/${ch}.glb`,
    animated: false,
    group: "letters",
  })),
];

const animalEntries: DemoModel[] = [
  {
    id: "cat",
    label: "Animated Cat",
    url: "/an_animated_cat.glb",
    animated: true,
    group: "animals",
  },
  {
    id: "dog",
    label: "Animated Dog",
    url: "/dog/source/dog.glb",
    animated: true,
    group: "animals",
  },
];

export const DEMO_MODELS: DemoModel[] = [...animalEntries, ...letterEntries];
