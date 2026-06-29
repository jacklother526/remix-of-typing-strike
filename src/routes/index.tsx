import { createFileRoute } from "@tanstack/react-router";
import TypingTowerGame from "@/components/TypingTowerGame";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Typing Tower Defense" },
      { name: "description", content: "Defend the base — type letters to fire your turret." },
      { property: "og:title", content: "Typing Tower Defense" },
      { property: "og:description", content: "Defend the base — type letters to fire your turret." },
    ],
  }),
  component: Index,
});

function Index() {
  return <TypingTowerGame />;
}
