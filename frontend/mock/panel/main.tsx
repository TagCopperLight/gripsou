// Mounts the review panel in its own React root, outside the app's tree, so
// the app renders exactly as it does in production.

import { createRoot } from "react-dom/client";
import { Panel } from "./Panel.tsx";

const host = document.createElement("div");
host.id = "gripsou-review-panel";
document.body.appendChild(host);
createRoot(host).render(<Panel />);
