import { createEditorDrawing } from './drawing.js';

// The existing runtime creates an unprepared singleton when bundled in a browser.
// This window uses the editor factory with its own scoped persistence callback instead.
window.__mpvFabricOverlay?.destroy();
delete window.__mpvFabricOverlay;
window.BAEEditorDrawing = Object.freeze({ createEditorDrawing });
