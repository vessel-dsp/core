// Proof element bundle entry (`/element.js`): evaluates the player barrel
// (whose import self-registers `<vessel-player>`) only when dynamically
// imported by `/page.js` AFTER the engine factory exists. Static HTML
// upgrades synchronously at define() time, so this split is the order.
import { registerVesselPlayer } from "@vessel-dsp/player";

registerVesselPlayer();
