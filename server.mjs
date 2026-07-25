import http from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { createHash } from "node:crypto";

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Book-Metadata, X-Book-File-Name",
    "Access-Control-Allow-Private-Network": "true"
  };

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (request.method === "POST" && url.pathname === "/api/books") {
    handleBookUpload(request, response, corsHeaders);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, corsHeaders);
    response.end("Method not allowed");
    return;
  }

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
  if (request.method === "HEAD") {
    response.end();
    return;
  }
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

async function handleBookUpload(request, response, corsHeaders) {
  try {
    const metadata = readMetadata(request.headers["x-book-metadata"]);
    if (!metadata.id) throw new Error("Missing book id.");

    const bytes = await readRequestBody(request);
    if (!bytes.length) throw new Error("Empty upload.");

    const booksRoot = join(root, "books");
    mkdirSync(booksRoot, { recursive: true });

    const id8 = String(metadata.id).slice(0, 8);
    const title = metadata.title || decodeURIComponent(String(request.headers["x-book-file-name"] || "book.abrbook")).replace(/\.abrbook$/i, "");
    const safeName = safeFileName(`${title}-${id8}.abrbook`);
    const targetPath = resolve(join(booksRoot, safeName));
    if (!targetPath.startsWith(booksRoot)) throw new Error("Bad file path.");

    const catalogPath = join(booksRoot, "library.json");
    const catalog = readCatalog(catalogPath);
    for (const book of catalog.books.filter(book => book.id === metadata.id)) {
      const oldPath = resolve(join(root, decodeURIComponent(String(book.file || "").replace(/^books\//, "books/"))));
      if (oldPath.startsWith(booksRoot) && existsSync(oldPath) && oldPath !== targetPath) {
        unlinkSync(oldPath);
      }
    }

    writeFileSync(targetPath, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const entry = {
      id: metadata.id,
      title,
      author: metadata.author || "",
      pageCount: metadata.pageCount || 0,
      file: `books/${encodeURIComponent(safeName)}`,
      sizeBytes: bytes.length,
      sha256,
      updatedAtUtc: new Date().toISOString()
    };

    catalog.books = catalog.books.filter(book => book.id !== metadata.id);
    catalog.books.push(entry);
    catalog.books.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    catalog.updatedAtUtc = new Date().toISOString();
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

    response.writeHead(200, {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify({ ok: true, book: entry }));
  } catch (error) {
    response.writeHead(400, {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify({ ok: false, error: error.message || "Upload failed." }));
  }
}

function readMetadata(header) {
  if (!header) throw new Error("Missing book metadata.");
  return JSON.parse(Buffer.from(String(header), "base64").toString("utf8"));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function readCatalog(catalogPath) {
  if (!existsSync(catalogPath)) {
    return { version: 1, updatedAtUtc: null, books: [] };
  }

  try {
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8").replace(/^\uFEFF/, ""));
    return {
      version: 1,
      updatedAtUtc: catalog.updatedAtUtc || null,
      books: Array.isArray(catalog.books) ? catalog.books : []
    };
  } catch {
    return { version: 1, updatedAtUtc: null, books: [] };
  }
}

function safeFileName(name) {
  return String(name || "book.abrbook")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "book.abrbook";
}
