import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gesture Overlay — Hand Tracking Emoji" },
      { name: "description", content: "Show emoji overlays with hand gestures, tracked in your browser." },
      { property: "og:title", content: "Gesture Overlay — Hand Tracking Emoji" },
      { property: "og:description", content: "Show emoji overlays with hand gestures, tracked in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/gesture/index.html"
      title="Gesture Overlay"
      allow="camera"
      className="block h-screen w-full border-0"
    />
  );
}
