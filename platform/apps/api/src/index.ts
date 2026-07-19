import { pathToFileURL } from "node:url";
import { createCapacityApiServer } from "./app.js";

export * from "./app.js";

export function startCapacityApi(port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? "127.0.0.1") {
  const server = createCapacityApiServer();
  server.listen(port, host, () => {
    const address = server.address();
    const bound = typeof address === "object" && address !== null ? `${address.address}:${address.port}` : String(address);
    console.log(`Capacity Assurance API listening on ${bound}`);
  });
  return server;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  startCapacityApi();
}
