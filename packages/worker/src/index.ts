import { runWorkerBootstrap } from "./application/runBootstrap.js";

runWorkerBootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
