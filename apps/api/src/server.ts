import { loadEnvFile, getPort } from "./config/env";

loadEnvFile();

import { buildApp } from "./app";

const app = buildApp();

app
  .listen({ port: getPort(), host: "0.0.0.0" })
  .then(() => app.log.info(`API listening on port ${getPort()}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
