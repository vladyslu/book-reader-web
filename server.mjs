import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { networkInterfaces } from "node:os";

const root = resolve(import.meta.dirname);
const port = Number.parseInt(process.env.PORT || "8765", 10);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".wav", "audio/wav"],
  [".abrbook", "application/octet-stream"]
]);

const server = http.createServer((request, response) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true"
  };

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(join(root, relative === "/" ? "index.html" : relative));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const info = statSync(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    ...corsHeaders,
    "Content-Type": contentTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Book Reader web app: http://localhost:${port}`);
  for (const address of localAddresses()) {
    console.log(`On your iPhone, try: http://${address}:${port}`);
  }
});

function localAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter(item => item && item.family === "IPv4" && !item.internal)
    .map(item => item.address);
}
