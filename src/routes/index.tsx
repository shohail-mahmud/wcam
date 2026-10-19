import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GestureOverlay — Camera Workspace" },
      { name: "description", content: "Private, on-device hand and face tracking with live gesture overlays." },
      { property: "og:title", content: "GestureOverlay — Camera Workspace" },
      { property: "og:description", content: "Private, on-device hand and face tracking with live gesture overlays." },
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
      allowFullScreen
      className="block h-screen w-full border-0"
    />
  );
}
