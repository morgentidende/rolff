import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startVersionCheck } from "./versionCheck";
import "./styles.css";
import "./export.css";
import "./native.css";
import { hasBackLayers } from "./backNavigation";
import { installNativeBackButton } from "./native/backButton";
import { installExternalLinkHandler } from "./native/externalLinks";
createRoot(document.getElementById("root")!).render(<App />);
startVersionCheck();
// Both are no-ops on the web; they only act inside a wrapped (native) app.
installExternalLinkHandler();
installNativeBackButton(hasBackLayers);
