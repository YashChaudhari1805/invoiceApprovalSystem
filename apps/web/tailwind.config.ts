import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0B0B10",
          900: "#15151D",
          700: "#3A3A46",
          500: "#6B6B78",
          300: "#B4B4BE",
          100: "#E9E9EE",
          50: "#F5F5F8",
        },
        accent: {
          700: "#3730A3",
          600: "#4338CA",
          500: "#4F46E5",
          100: "#E5E3FB",
          50: "#F3F2FE",
        },
        mint: {
          500: "#0F9D80",
          100: "#DFF5EE",
          50: "#F0FBF8",
        },
        amber: {
          600: "#B45309",
          100: "#FDEDD3",
        },
        rose: {
          600: "#BE123C",
          100: "#FCE4E9",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)", "sans-serif"],
        sans: ["var(--font-body)", "sans-serif"],
      },
      backgroundImage: {
        "wash-radial":
          "radial-gradient(120% 120% at 10% 0%, #F3F2FE 0%, #FAFAFA 45%, #F0FBF8 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
