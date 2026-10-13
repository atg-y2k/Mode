/**
 * Keyframes for the shell's small entrance animations (Tailwind arbitrary
 * `animate-[mode-…]` utilities reference these). Rendered once by <App/>.
 * Every use is wrapped in `motion-safe:` so reduced-motion users see no motion.
 */
const CSS = `
@keyframes mode-toast-in { from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none } }
@keyframes mode-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes mode-rise-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes mode-pop-in { from { opacity: 0; transform: translateY(-4px) scale(.97) } to { opacity: 1; transform: none } }
`;

export function ShellStyles() {
  return <style>{CSS}</style>;
}
