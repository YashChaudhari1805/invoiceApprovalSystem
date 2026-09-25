import type { Config } from "tailwindcss";

// Every color below resolves through a CSS custom property (see
// app/globals.css) rather than a fixed hex value, so the whole app can
// switch theme by flipping one attribute (`<html data-theme="light">`)
// without touching a single component. `<alpha-value>` is Tailwind's
// placeholder for opacity modifiers (e.g. `bg-canvas/50`) to keep working —
// it requires the CSS var to hold space-separated "R G B", not a hex string.
function themedColor(name: string) {
  return `rgb(var(--color-${name}) / <alpha-value>)`;
}

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: themedColor("canvas"),
        surface: themedColor("surface"),
        "surface-high": themedColor("surface-high"), // hover/focus "state layer" — one step lighter than surface

        // Text + border scale. ink-950 is always the *highest emphasis*
        // tone (headings) and ink-50 the most recessed (hover background) —
        // what that actually renders as is inverted between themes by the
        // CSS variables themselves, not by this scale.
        ink: {
          950: themedColor("ink-950"),
          900: themedColor("ink-900"),
          700: themedColor("ink-700"),
          500: themedColor("ink-500"),
          300: themedColor("ink-300"),
          100: themedColor("ink-100"),
          50: themedColor("ink-50"),
        },
        // Primary brand hue — Material's iconic violet, tuned per theme for contrast.
        accent: {
          700: themedColor("accent-700"), // button hover/pressed
          600: themedColor("accent-600"), // button fill, default link color
          500: themedColor("accent-500"), // focus ring/border
          100: themedColor("accent-100"), // tonal container (active nav pill, etc.)
          50: themedColor("accent-50"),
        },
        // Status tonal pairs — "container + on-container", same pattern
        // Material uses for its own status/assist chips.
        mint: {
          500: themedColor("mint-500"), // approved: text/icon
          100: themedColor("mint-100"), // approved: chip container
        },
        amber: {
          600: themedColor("amber-600"), // in review: text/icon
          100: themedColor("amber-100"), // in review: chip container
        },
        rose: {
          600: themedColor("rose-600"), // rejected/error: text/icon
          100: themedColor("rose-100"), // rejected/error: chip container
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)", "sans-serif"],
        sans: ["var(--font-body)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
