import path from "node:path";
import nextEnv from "@next/env";

// One .env for the whole repo: load the root file so the web app shares the API's
// Supabase settings. apps/web/.env.local can still override any value.
nextEnv.loadEnvConfig(path.resolve(import.meta.dirname, "../.."));

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
  },
  experimental: {
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
