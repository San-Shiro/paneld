import React from "react";
import { createRoot } from "react-dom/client";
import { StoryboardStudio } from "../src";

const peerColors = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#3b82f6"];
const randomColor = peerColors[Math.floor(Math.random() * peerColors.length)]!;
const randomId = Math.floor(100 + Math.random() * 900);

function App() {
  return (
    <StoryboardStudio
      userName={`Artist #${randomId}`}
      userColor={randomColor}
    />
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
