import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FieldApp from "./FieldApp.js";
import "./styles.css";
import "./recovery.css";
import "./exports.css";
import "./explanation.css";
import "./harmonize.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root was not found");

createRoot(root).render(
  <StrictMode>
    <FieldApp />
  </StrictMode>,
);
