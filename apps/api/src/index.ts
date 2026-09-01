import * as dotenv from "dotenv";
import path from "path";

// Load the root .env before anything else runs. Safe regardless of import
// hoisting because src/lib/supabase.ts no longer reads process.env at
// import time — only lazily, the first time a request needs a client.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { buildApp } from "./app";

const app = buildApp();

const port = Number(process.env.PORT) || 4000;
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`API listening on port ${port}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
