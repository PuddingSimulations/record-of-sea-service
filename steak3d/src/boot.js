// score.js and the renderer read the global Sim, as in the 2D prototype. Import this first.
import Sim from './sim.js';
globalThis.Sim = Sim;
export default Sim;
