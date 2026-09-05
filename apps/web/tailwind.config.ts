import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Fixed dark-mode canvas/card tones — separate from the `ink` text
        // scale below since this app is permanently dark, not a light theme
        // with a dark variant. Material's own model: canvas is the darkest
        // layer, surface (cards/sidebar/table) sits one tonal step above it.
        canvas: "#121016",
        surface: "#1B1820",
        "surface-high": "#2B2733", // hover/focus "state layer" — one step lighter than surface

        // Text + border scale. Numeric scale kept for minimal diff against
        // existing markup, but re-tuned so 950 is the brightest (highest
        // emphasis) tone and 50 the most recessed, matching how this app
        // actually consumes the scale (bg-ink-50 = canvas/hover, ink-950 =
        // headline text) rather than the literal "50=lightest" convention.
        ink: {
          950: "#F5F2F8", // headings, primary values
          900: "#E8E3EF", // strong body text
          700: "#C6BFD1", // default body text
          500: "#948C9E", // secondary/meta text, labels
          300: "#6B6478", // lowest-emphasis text
          100: "#322E3B", // borders, dividers, neutral chip backgrounds
          50: "#2B2733", // hover/focus background over a surface card
        },
        // Primary brand hue — Material's iconic violet, tuned for this app.
        accent: {
          700: "#6D4FE0", // button hover/pressed
          600: "#7C5CFC", // button fill, default link color
          500: "#9C86FF", // focus ring/border — brighter, for visibility
          100: "#2A2340", // dark tonal container (active nav pill, etc.)
          50: "#211C33",
        },
        // Status tonal pairs — "container + on-container", same pattern
        // Material uses for its own status/assist chips.
        mint: {
          500: "#6FE0A0", // approved: text/icon
          100: "#16341F", // approved: chip container
        },
        amber: {
          600: "#FFC25C", // in review: text/icon
          100: "#402D08", // in review: chip container
        },
        rose: {
          600: "#FF8C86", // rejected/error: text/icon
          100: "#401318", // rejected/error: chip container
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
