import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startVersionCheck } from "./versionCheck";
import "./styles.css";
import "./export.css";
createRoot(document.getElementById("root")!).render(<App />);
startVersionCheck();
