import { normalizePath, readZip } from "./zip-reader.js";

const DB_NAME = "book-reader-web";
const DB_VERSION = 1;
const SETTINGS_KEY = "book-reader-settings";
const STATE_KEY_PREFIX = "book-reader-state:";
const BOOKMARK_KEY_PREFIX = "book-reader-bookmarks:";

const textDecoder = new TextDecoder();
const state = {
  db: null,
  books: [],
  currentBook: null,
  currentManifest: null,
  currentPageNumber: 1,
  currentPage: null,
  currentUrls: [],
  currentWordIndex: -1,
  saveTimer: null,
  settings: loadSettings()
};

const els = {
  statusText: document.getElementById("statusText"),
  packageInput: document.getElementById("packageInput"),
  libraryList: document.getElementById("libraryList"),
  deleteBookButton: document.getElementById("deleteBookButton"),
  emptyState: document.getElementById("emptyState"),
  pageView: document.getElementById("pageView"),
  bookTitle: document.getElementById("bookTitle"),
  pageLabel: document.getElementById("pageLabel"),
  pageImage: document.getElementById("pageImage"),
  textView: document.getElementById("textView"),
  audio: document.getElementById("audioPlayer"),
  previousPageButton: document.getElementById("previousPageButton"),
  nextPageButton: document.getElementById("nextPageButton"),
  rewindButton: document.getElementById("rewindButton"),
  playPauseButton: document.getElementById("playPauseButton"),
  forwardButton: document.getElementById("forwardButton"),
  progressSlider: document.getElementById("progressSlider"),
  elapsedLabel: document.getElementById("elapsedLabel"),
  durationLabel: document.getElementById("durationLabel"),
  bookmarkButton: document.getElementById("bookmarkButton"),
  bookmarksButton: document.getElementById("bookmarksButton"),
  showImagesToggle: document.getElementById("showImagesToggle"),
  bookmarkDialog: document.getElementById("bookmarkDialog"),
  bookmarkList: document.getElementById("bookmarkList")
};

init().catch(error => {
  console.error(error);
  setStatus(error.message || "Could not start reader.");
});

async function init() {
  if (!("indexedDB" in window)) {
    throw new Error("This browser cannot store books locally.");
  }

  if (!("DecompressionStream" in window)) {
    throw new Error("This browser is too old to import .abrbook files.");
  }

  state.db = await openDb();
  await registerServiceWorker();
  bindEvents();
  els.showImagesToggle.checked = state.settings.showImages;
  await refreshLibrary();
  setReaderEnabled(false);
  setStatus(state.books.length ? "Ready" : "Import an .abrbook package.");
}

function bindEvents() {
  els.packageInput.addEventListener("change", onPackageSelected);
  els.deleteBookButton.addEventListener("click", deleteCurrentBook);
  els.previousPageButton.addEventListener("click", () => movePage(-1));
  els.nextPageButton.addEventListener("click", () => movePage(1));
  els.rewindButton.addEventListener("click", () => seekBy(-15));
  els.forwardButton.addEventListener("click", () => seekBy(15));
  els.playPauseButton.addEventListener("click", togglePlayback);
  els.progressSlider.addEventListener("input", () => {
    els.audio.currentTime = Number(els.progressSlider.value);
    updateFromAudio();
  });
  els.bookmarkButton.addEventListener("click", saveBookmark);
  els.bookmarksButton.addEventListener("click", showBookmarks);
  els.showImagesToggle.addEventListener("change", async () => {
    state.settings.showImages = els.showImagesToggle.checked;
    saveSettings(state.settings);
    await reloadCurrentPage({ keepPlaying: !els.audio.paused, keepTime: els.audio.currentTime });
  });

  els.audio.addEventListener("timeupdate", () => {
    updateFromAudio();
    scheduleStateSave();
  });
  els.audio.addEventListener("loadedmetadata", updateFromAudio);
  els.audio.addEventListener("play", updateFromAudio);
  els.audio.addEventListener("pause", updateFromAudio);
  els.audio.addEventListener("ended", () => {
    updateFromAudio();
    if (state.currentManifest && state.currentPageNumber < state.currentManifest.pageCount) {
      movePage(1);
    }
  });
  window.addEventListener("beforeunload", saveReadingState);
}

async function onPackageSelected(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    setStatus(`Importing ${file.name}...`);
    setReaderEnabled(false);
    const archive = await readZip(file);
    const manifest = await readJsonEntry(archive, "manifest.json");
    validateManifest(manifest);
    await storeBook(file, manifest, archive);
    await refreshLibrary();
    await openBook(manifest.id);
    setStatus(`Imported ${manifest.title}.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Import failed.");
  }
}

async function refreshLibrary() {
  state.books = await getAllBooks();
  renderLibrary();
}

function renderLibrary() {
  els.libraryList.replaceChildren();
  if (state.books.length === 0) {
    const empty = document.createElement("p");
    empty.className = "book-meta";
    empty.textContent = "No books yet.";
    els.libraryList.append(empty);
    return;
  }

  for (const book of state.books) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `book-item${state.currentBook?.id === book.id ? " active" : ""}`;
    button.innerHTML = `
      <span class="book-title">${escapeHtml(book.title)}</span>
      <span class="book-meta">${book.pageCount} pages</span>
    `;
    button.addEventListener("click", () => openBook(book.id));
    els.libraryList.append(button);
  }
}

async function openBook(bookId) {
  saveReadingState();
  const book = await getBook(bookId);
  if (!book) {
    setStatus("Book not found.");
    return;
  }

  state.currentBook = book;
  state.currentManifest = book.manifest;
  const saved = loadReadingState(book.id);
  state.currentPageNumber = clamp(saved?.pageNumber || 1, 1, book.pageCount);
  renderLibrary();
  await loadPage(state.currentPageNumber, saved);
  setReaderEnabled(true);
  setStatus(book.title);
}

async function loadPage(pageNumber, savedState = null) {
  if (!state.currentBook || !state.currentManifest) return;

  revokeCurrentUrls();
  const manifestPage = state.currentManifest.pages.find(page => page.pageNumber === pageNumber);
  if (!manifestPage) throw new Error(`Page ${pageNumber} was not found.`);

  const pageJson = await readStoredJson(state.currentBook.id, manifestPage.textPath);
  const timings = await readStoredJson(state.currentBook.id, manifestPage.timingsPath);
  const audioBlob = await readStoredBlob(state.currentBook.id, manifestPage.audioPath);
  const audioUrl = URL.createObjectURL(audioBlob);
  state.currentUrls.push(audioUrl);

  let imageUrl = "";
  if (state.settings.showImages && manifestPage.imagePath) {
    const imageBlob = await readStoredBlob(state.currentBook.id, manifestPage.imagePath).catch(() => null);
    if (imageBlob) {
      imageUrl = URL.createObjectURL(imageBlob);
      state.currentUrls.push(imageUrl);
    }
  }

  state.currentPageNumber = pageNumber;
  state.currentPage = {
    manifestPage,
    text: pageJson.text || "",
    timings: Array.isArray(timings) ? timings : [],
    duration: manifestPage.durationSeconds || 0
  };

  els.emptyState.hidden = true;
  els.pageView.hidden = false;
  els.bookTitle.textContent = state.currentManifest.title;
  els.pageLabel.textContent = `Page ${pageNumber} / ${state.currentManifest.pageCount}`;
  els.pageImage.hidden = !imageUrl;
  els.pageImage.src = imageUrl;
  els.pageImage.alt = imageUrl ? `Generated image for page ${pageNumber}` : "";
  els.textView.innerHTML = renderText(state.currentPage.text, state.currentPage.timings);
  els.audio.src = audioUrl;
  els.progressSlider.max = String(Math.max(1, state.currentPage.duration));
  els.progressSlider.value = String(savedState?.pageNumber === pageNumber ? savedState.audioPositionSeconds || 0 : 0);
  els.elapsedLabel.textContent = formatTime(Number(els.progressSlider.value));
  els.durationLabel.textContent = formatTime(state.currentPage.duration);
  els.playPauseButton.textContent = "Play";

  const seek = savedState?.pageNumber === pageNumber ? savedState.audioPositionSeconds || 0 : 0;
  els.audio.addEventListener("loadedmetadata", () => {
    els.audio.currentTime = Math.min(seek, els.audio.duration || state.currentPage.duration || 0);
    updateFromAudio();
  }, { once: true });

  updateNavButtons();
}

async function reloadCurrentPage(options = {}) {
  if (!state.currentBook) return;
  const saved = {
    pageNumber: state.currentPageNumber,
    audioPositionSeconds: options.keepTime || els.audio.currentTime || 0,
    wordIndex: state.currentWordIndex
  };
  await loadPage(state.currentPageNumber, saved);
  if (options.keepPlaying) {
    try {
      await els.audio.play();
    } catch {
      setStatus("Tap Play to continue.");
    }
  }
}

async function movePage(delta) {
  if (!state.currentManifest) return;
  saveReadingState();
  const next = clamp(state.currentPageNumber + delta, 1, state.currentManifest.pageCount);
  if (next === state.currentPageNumber) return;
  await loadPage(next);
  setStatus(state.currentBook.title);
}

async function togglePlayback() {
  if (!state.currentBook) return;
  if (els.audio.paused) {
    try {
      await els.audio.play();
    } catch {
      setStatus("Audio was blocked. Tap Play again.");
    }
  } else {
    els.audio.pause();
  }
  updateFromAudio();
}

function seekBy(seconds) {
  if (!state.currentBook) return;
  const duration = els.audio.duration || state.currentPage?.duration || 1;
  els.audio.currentTime = clamp((els.audio.currentTime || 0) + seconds, 0, duration);
  updateFromAudio();
}

function updateFromAudio() {
  const duration = els.audio.duration || state.currentPage?.duration || 1;
  const time = clamp(els.audio.currentTime || 0, 0, duration);
  els.progressSlider.max = String(Math.max(1, duration));
  els.progressSlider.value = String(time);
  els.elapsedLabel.textContent = formatTime(time);
  els.durationLabel.textContent = formatTime(duration);
  els.playPauseButton.textContent = els.audio.paused ? "Play" : "Pause";
  updateHighlight(time);
}

function updateHighlight(time) {
  const timings = state.currentPage?.timings || [];
  const index = timings.findIndex(word => time >= word.startSeconds && time <= word.endSeconds);
  const nextIndex = index >= 0
    ? index
    : timings.length && time > timings[timings.length - 1].endSeconds
      ? timings.length
      : state.currentWordIndex;

  if (nextIndex === state.currentWordIndex) return;

  const old = els.textView.querySelector(".word.current");
  old?.classList.remove("current");
  state.currentWordIndex = nextIndex;

  for (const word of els.textView.querySelectorAll(".word")) {
    const wordIndex = Number(word.dataset.index);
    word.classList.toggle("read", wordIndex < nextIndex);
  }

  const current = els.textView.querySelector(`.word[data-index="${nextIndex}"]`);
  if (current) {
    current.classList.add("current");
    current.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function saveBookmark() {
  if (!state.currentBook) return;
  const bookmarks = loadBookmarks(state.currentBook.id);
  const bookmark = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    pageNumber: state.currentPageNumber,
    wordIndex: Math.max(0, state.currentWordIndex),
    audioPositionSeconds: els.audio.currentTime || 0,
    createdAtUtc: new Date().toISOString()
  };
  const filtered = bookmarks.filter(item =>
    item.pageNumber !== bookmark.pageNumber || item.wordIndex !== bookmark.wordIndex
  );
  filtered.push(bookmark);
  saveBookmarks(state.currentBook.id, filtered);
  setStatus(`Bookmarked page ${bookmark.pageNumber}.`);
}

function showBookmarks() {
  if (!state.currentBook) return;
  const bookmarks = loadBookmarks(state.currentBook.id)
    .sort((a, b) => a.pageNumber - b.pageNumber || a.wordIndex - b.wordIndex);
  els.bookmarkList.replaceChildren();

  if (bookmarks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "book-meta";
    empty.textContent = "No bookmarks saved.";
    els.bookmarkList.append(empty);
  } else {
    for (const bookmark of bookmarks) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Page ${bookmark.pageNumber}, word ${bookmark.wordIndex + 1}`;
      button.addEventListener("click", async () => {
        els.bookmarkDialog.close();
        await loadPage(bookmark.pageNumber, {
          pageNumber: bookmark.pageNumber,
          wordIndex: bookmark.wordIndex,
          audioPositionSeconds: bookmark.audioPositionSeconds || 0
        });
      });
      els.bookmarkList.append(button);
    }
  }

  if (typeof els.bookmarkDialog.showModal === "function") {
    els.bookmarkDialog.showModal();
  }
}

function scheduleStateSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveReadingState, 500);
}

function saveReadingState() {
  if (!state.currentBook) return;
  localStorage.setItem(`${STATE_KEY_PREFIX}${state.currentBook.id}`, JSON.stringify({
    bookId: state.currentBook.id,
    pageNumber: state.currentPageNumber,
    wordIndex: Math.max(0, state.currentWordIndex),
    audioPositionSeconds: els.audio.currentTime || 0,
    updatedAtUtc: new Date().toISOString()
  }));
}

function loadReadingState(bookId) {
  return readLocalJson(`${STATE_KEY_PREFIX}${bookId}`, null);
}

function loadBookmarks(bookId) {
  return readLocalJson(`${BOOKMARK_KEY_PREFIX}${bookId}`, []);
}

function saveBookmarks(bookId, bookmarks) {
  localStorage.setItem(`${BOOKMARK_KEY_PREFIX}${bookId}`, JSON.stringify(bookmarks));
}

function loadSettings() {
  return readLocalJson(SETTINGS_KEY, { showImages: true });
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function readLocalJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function storeBook(sourceFile, manifest, archive) {
  const book = {
    id: manifest.id,
    title: manifest.title || sourceFile.name,
    author: manifest.author || "",
    pageCount: manifest.pageCount || manifest.pages?.length || 0,
    sourceName: sourceFile.name,
    importedAtUtc: new Date().toISOString(),
    manifest
  };

  let tx = state.db.transaction("books", "readwrite");
  await requestToPromise(tx.objectStore("books").put(book));
  await txDone(tx);

  for (const [path, entry] of archive.entries) {
    if (entry.directory) continue;
    const bytes = await archive.readBytes(path);
    tx = state.db.transaction("files", "readwrite");
    await requestToPromise(tx.objectStore("files").put({
      key: `${manifest.id}/${path}`,
      bookId: manifest.id,
      path,
      blob: new Blob([bytes], { type: mimeForPath(path) })
    }));
    await txDone(tx);
  }
}

async function getAllBooks() {
  const tx = state.db.transaction("books", "readonly");
  const books = await requestToPromise(tx.objectStore("books").getAll());
  return books.sort((a, b) => new Date(b.importedAtUtc) - new Date(a.importedAtUtc));
}

async function getBook(bookId) {
  const tx = state.db.transaction("books", "readonly");
  return requestToPromise(tx.objectStore("books").get(bookId));
}

async function readStoredBlob(bookId, path) {
  const tx = state.db.transaction("files", "readonly");
  const row = await requestToPromise(tx.objectStore("files").get(`${bookId}/${normalizePath(path)}`));
  if (!row?.blob) throw new Error(`Missing package file: ${path}`);
  return row.blob;
}

async function readStoredJson(bookId, path) {
  const blob = await readStoredBlob(bookId, path);
  return JSON.parse(await blob.text());
}

async function deleteCurrentBook() {
  if (!state.currentBook) return;
  if (!confirm(`Delete ${state.currentBook.title}?`)) return;
  const bookId = state.currentBook.id;
  const tx = state.db.transaction(["books", "files"], "readwrite");
  await requestToPromise(tx.objectStore("books").delete(bookId));
  const index = tx.objectStore("files").index("bookId");
  const range = IDBKeyRange.only(bookId);
  await new Promise((resolve, reject) => {
    const request = index.openCursor(range);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });
  await txDone(tx);
  localStorage.removeItem(`${STATE_KEY_PREFIX}${bookId}`);
  localStorage.removeItem(`${BOOKMARK_KEY_PREFIX}${bookId}`);
  clearReader();
  await refreshLibrary();
  setStatus("Book deleted.");
}

function clearReader() {
  revokeCurrentUrls();
  state.currentBook = null;
  state.currentManifest = null;
  state.currentPage = null;
  els.audio.removeAttribute("src");
  els.pageView.hidden = true;
  els.emptyState.hidden = false;
  setReaderEnabled(false);
  renderLibrary();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("books")) {
        db.createObjectStore("books", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("files")) {
        const files = db.createObjectStore("files", { keyPath: "key" });
        files.createIndex("bookId", "bookId", { unique: false });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function readJsonEntry(archive, path) {
  return JSON.parse(textDecoder.decode(await archive.readBytes(path)));
}

function validateManifest(manifest) {
  if (!manifest || manifest.formatVersion !== 1 || !manifest.id || !Array.isArray(manifest.pages)) {
    throw new Error("Unsupported or invalid .abrbook package.");
  }
}

function renderText(text, timings) {
  if (!Array.isArray(timings) || timings.length === 0) {
    return textBlocks(text).map((block, index) =>
      `<${blockTag(block.text, index)}>${escapeHtml(normalizeWhitespace(block.text))}</${blockTag(block.text, index)}>`
    ).join("");
  }

  return textBlocks(text).map((block, blockIndex) => {
    const tag = blockTag(block.text, blockIndex);
    let cursor = block.start;
    let html = "";
    const blockEnd = block.start + block.length;

    for (const timing of timings) {
      if (timing.textOffset < block.start || timing.textOffset >= blockEnd) continue;
      if (timing.textOffset > cursor) {
        html += escapeHtml(normalizeWhitespace(text.slice(cursor, timing.textOffset)));
      }
      const end = clamp(timing.textOffset + Math.max(0, timing.textLength || 0), timing.textOffset, blockEnd);
      const wordText = end > timing.textOffset ? text.slice(timing.textOffset, end) : timing.word || "";
      html += `<span class="word" data-index="${Number(timing.index) || 0}">${escapeHtml(wordText)}</span>`;
      cursor = Math.max(cursor, end);
    }

    if (cursor < blockEnd) {
      html += escapeHtml(normalizeWhitespace(text.slice(cursor, blockEnd)));
    }

    return `<${tag}>${html}</${tag}>`;
  }).join("");
}

function textBlocks(text) {
  const blocks = [];
  const pattern = /\S[\s\S]*?(?=(?:\r?\n){2,}|$)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    let start = match.index;
    let value = match[0];
    while (value.length && /\s/.test(value[0])) {
      start += 1;
      value = value.slice(1);
    }
    value = value.replace(/\s+$/g, "");
    if (value) blocks.push({ start, length: value.length, text: value });
  }
  return blocks;
}

function blockTag(text, index) {
  const normalized = normalizeWhitespace(text).trim();
  if ((index === 0 || index === 1) && looksLikeHeading(normalized)) {
    return index === 0 ? "h1" : "h2";
  }
  return "p";
}

function looksLikeHeading(text) {
  if (text.length < 4 || text.length > 120 || /[.!?"']$/.test(text)) return false;
  const words = Array.from(text.matchAll(/\p{L}+/gu)).map(match => match[0]);
  if (words.length < 2 || words.length > 14) return false;
  const titleish = words.filter(word => word.length <= 3 || word[0] === word[0].toUpperCase()).length;
  return titleish >= Math.ceil(words.length * 0.65);
}

function updateNavButtons() {
  const hasBook = Boolean(state.currentBook && state.currentManifest);
  els.previousPageButton.disabled = !hasBook || state.currentPageNumber <= 1;
  els.nextPageButton.disabled = !hasBook || state.currentPageNumber >= state.currentManifest.pageCount;
}

function setReaderEnabled(enabled) {
  for (const element of [
    els.previousPageButton,
    els.nextPageButton,
    els.rewindButton,
    els.playPauseButton,
    els.forwardButton,
    els.progressSlider,
    els.bookmarkButton,
    els.bookmarksButton,
    els.showImagesToggle
  ]) {
    element.disabled = !enabled;
  }
  els.deleteBookButton.disabled = !enabled;
  if (enabled) updateNavButtons();
}

function revokeCurrentUrls() {
  for (const url of state.currentUrls) {
    URL.revokeObjectURL(url);
  }
  state.currentUrls = [];
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (error) {
      console.warn("Service worker registration failed.", error);
    }
  }
}

function mimeForPath(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const rounded = Math.floor(safe);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function setStatus(message) {
  els.statusText.textContent = message;
}
