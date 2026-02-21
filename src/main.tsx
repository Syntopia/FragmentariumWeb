import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/global.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Missing root element.");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
