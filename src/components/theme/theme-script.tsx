/**
 * Applies the saved theme before first paint so a light-theme user never sees a
 * dark flash. Dark is the default (docs/DESIGN.md); "light" is opt-in and stored
 * per device in localStorage under `superlega-theme`.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("superlega-theme");var l=t==="light";var c=document.documentElement.classList;c.toggle("light",l);c.toggle("dark",!l);var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m);}m.setAttribute("content",l?"#f4f7fb":"#05080f");}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
