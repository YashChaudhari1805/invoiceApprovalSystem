import * as dotenv from "dotenv";
import path from "path";

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
