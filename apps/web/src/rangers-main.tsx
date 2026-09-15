import React from "react";
import { createRoot } from "react-dom/client";
import { RangersView } from "./views/RangersView";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RangersView />
  </React.StrictMode>,
);
