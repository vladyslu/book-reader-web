const textDecoder = new TextDecoder();

export async function readZip(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = parseZipEntries(bytes);
  return {
    entries,
    async readBytes(path) {
      const entry = entries.get(normalizePath(path));
      if (!entry) throw new Error(`Missing package file: ${path}`);
      if (entry.directory) return new Uint8Array();
      if (entry.method === 0) return entry.compressed;
      if (entry.method === 8) return inflateRaw(entry.compressed);
      throw new Error(`Unsupported ZIP compression method ${entry.method} in ${path}.`);
    }
  };
}

export function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function parseZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  let offset = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid package central directory.");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const rawName = bytes.slice(offset + 46, offset + 46 + nameLength);
    const name = normalizePath(textDecoder.decode(rawName));
    offset += 46 + nameLength + extraLength + commentLength;

    if (!name || isUnsafePath(name)) {
      throw new Error(`Unsafe package path: ${name}`);
    }

    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid package entry: ${name}`);
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    entries.set(name, {
      name,
      method,
      compressed,
      directory: name.endsWith("/")
    });
  }

  return entries;
}

function findEndOfCentralDirectory(view) {
  const min = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= min; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("This does not look like an .abrbook package.");
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function isUnsafePath(path) {
  return path.includes("../") || path.startsWith("/") || /^[a-z]:/i.test(path);
}
