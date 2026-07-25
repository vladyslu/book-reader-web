import { normalizePath, readZip } from "./zip-reader.js";

const DB_NAME = "book-reader-web";
const DB_VERSION = 1;
const CATALOG_URL = "books/library.json";
const SETTINGS_KEY = "book-reader-settings";
const HOME_SERVER_KEY = "book-reader-home-server";
const DEFAULT_HOME_SERVER_URL = "http://192.168.1.90:8765";
const OLD_EXAMPLE_HOME_SERVER_URL = "http://192.168.1.25:8765";
const STATE_KEY_PREFIX = "book-reader-state:";
const BOOKMARK_KEY_PREFIX = "book-reader-bookmarks:";
const DICTIONARY_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const SPEAKER_COLORS = [
  "#d7263d",
  "#0077b6",
  "#2f9e44",
  "#f76707",
  "#7b2cbf",
  "#0ca678",
  "#c2255c",
  "#e67700",
  "#364fc7",
  "#5c940d",
  "#ae3ec9",
  "#087f5b"
];
const NARRATOR_COLOR = "#495057";
const FALLBACK_COLOR = "#868e96";

const textDecoder = new TextDecoder();
const state = {
  db: null,
  books: [],
  catalogBooks: [],
  currentBook: null,
  currentManifest: null,
  currentPageNumber: 1,
  currentPage: null,
  currentUrls: [],
  currentWordIndex: -1,
  currentSentenceId: "",
  definitionWordIndex: -1,
  homeServerUrl: "",
  lastHomeLibraryError: "",
  saveTimer: null,
  settings: loadSettings()
};

const els = {
  statusText: document.getElementById("statusText"),
  packageInput: document.getElementById("packageInput"),
  refreshCatalogButton: document.getElementById("refreshCatalogButton"),
  homeServerButton: document.getElementById("homeServerButton"),
  homeLibraryInput: document.getElementById("homeLibraryInput"),
  saveHomeBooksButton: document.getElementById("saveHomeBooksButton"),
  libraryList: document.getElementById("libraryList"),
  catalogList: document.getElementById("catalogList"),
  deleteBookButton: document.getElementById("deleteBookButton"),
  emptyState: document.getElementById("emptyState"),
  pageView: document.getElementById("pageView"),
  bookTitle: document.getElementById("bookTitle"),
  pageLabel: document.getElementById("pageLabel"),
  pageImage: document.getElementById("pageImage"),
  speakerLegend: document.getElementById("speakerLegend"),
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
  readerFontSelect: document.getElementById("readerFontSelect"),
  homeServerDialog: document.getElementById("homeServerDialog"),
  homeServerForm: document.getElementById("homeServerForm"),
  homeServerMessage: document.getElementById("homeServerMessage"),
  homeServerUrl: document.getElementById("homeServerUrl"),
  homeServerCloseButton: document.getElementById("homeServerCloseButton"),
  clearHomeServerButton: document.getElementById("clearHomeServerButton"),
  bookmarkDialog: document.getElementById("bookmarkDialog"),
  bookmarkList: document.getElementById("bookmarkList"),
  definitionDialog: document.getElementById("definitionDialog"),
  definitionWord: document.getElementById("definitionWord"),
  definitionContext: document.getElementById("definitionContext"),
  definitionResults: document.getElementById("definitionResults"),
  definitionSeekButton: document.getElementById("definitionSeekButton"),
  definitionCopyButton: document.getElementById("definitionCopyButton")
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
  state.homeServerUrl = loadHomeServerUrl();
  await registerServiceWorker();
  bindEvents();
  renderHomeServerState();
  els.showImagesToggle.checked = state.settings.showImages;
  els.readerFontSelect.value = normalizeReaderFont(state.settings.readerFont);
  applyReaderFont(els.readerFontSelect.value);
  await refreshLibrary();
  await refreshCatalog();
  setReaderEnabled(false);
  setStatus(state.books.length || state.catalogBooks.length ? "Ready" : "Import an .abrbook package or connect Home PC.");
}

function bindEvents() {
  els.homeServerForm.addEventListener("submit", saveHomeServer);
  els.homeServerButton.addEventListener("click", showHomeServerDialog);
  els.homeServerCloseButton.addEventListener("click", () => els.homeServerDialog.close());
  els.clearHomeServerButton.addEventListener("click", clearHomeServer);
  els.homeLibraryInput.addEventListener("change", uploadHomeLibraryBook);
  els.saveHomeBooksButton.addEventListener("click", saveUnsavedHomeBooks);
  els.packageInput.addEventListener("change", onPackageSelected);
  els.refreshCatalogButton.addEventListener("click", refreshCatalog);
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
  els.textView.addEventListener("click", onTextViewClick);
  els.definitionSeekButton.addEventListener("click", () => {
    if (state.definitionWordIndex >= 0) {
      seekToWordIndex(state.definitionWordIndex);
      els.definitionDialog.close();
    }
  });
  els.definitionCopyButton.addEventListener("click", async () => {
    const word = normalizeLookupWord(els.definitionWord.textContent);
    if (!word) return;
    try {
      await navigator.clipboard.writeText(word);
      setStatus(`Copied ${word}.`);
    } catch {
      setStatus(word);
    }
  });
  els.showImagesToggle.addEventListener("change", async () => {
    state.settings.showImages = els.showImagesToggle.checked;
    saveSettings(state.settings);
    await reloadCurrentPage({ keepPlaying: !els.audio.paused, keepTime: els.audio.currentTime });
  });
  els.readerFontSelect.addEventListener("change", () => {
    state.settings.readerFont = normalizeReaderFont(els.readerFontSelect.value);
    saveSettings(state.settings);
    applyReaderFont(state.settings.readerFont);
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

function loadHomeServerUrl() {
  const saved = normalizeHomeServerUrl(localStorage.getItem(HOME_SERVER_KEY));
  if (saved === OLD_EXAMPLE_HOME_SERVER_URL || saved === "http://192.168.1.95:8765") {
    localStorage.setItem(HOME_SERVER_KEY, DEFAULT_HOME_SERVER_URL);
    return DEFAULT_HOME_SERVER_URL;
  }
  if (saved) return saved;
  if (location.protocol === "http:") return location.origin;
  return DEFAULT_HOME_SERVER_URL;
}

function normalizeHomeServerUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function showHomeServerDialog() {
  renderHomeServerState();
  if (!els.homeServerDialog.open && typeof els.homeServerDialog.showModal === "function") {
    els.homeServerDialog.showModal();
  } else {
    els.homeServerDialog.open = true;
  }
  setTimeout(() => els.homeServerUrl.focus(), 50);
}

async function saveHomeServer(event) {
  event.preventDefault();
  const url = normalizeHomeServerUrl(els.homeServerUrl.value);
  if (!url) {
    setHomeServerMessage("Enter the Home PC URL, like http://192.168.1.23:8765.");
    return;
  }

  state.homeServerUrl = url;
  localStorage.setItem(HOME_SERVER_KEY, url);
  state.lastHomeLibraryError = "";
  renderHomeServerState();
  els.homeServerDialog.close();
  await refreshCatalog();
}

async function clearHomeServer() {
  localStorage.removeItem(HOME_SERVER_KEY);
  state.homeServerUrl = location.protocol === "http:" ? location.origin : "";
  state.lastHomeLibraryError = "";
  renderHomeServerState();
  await refreshCatalog();
}

function renderHomeServerState() {
  const base = currentHomeServerUrl();
  els.homeServerUrl.value = state.homeServerUrl || "";
  els.homeServerButton.textContent = base ? "Home PC" : "Set Home PC";
  els.homeServerMessage.textContent = state.lastHomeLibraryError || (base
    ? `Using ${base}.`
    : "Enter the Home PC URL while you are on the same Wi-Fi.");
}

function setHomeServerMessage(message) {
  state.lastHomeLibraryError = message;
  els.homeServerMessage.textContent = message;
}

function currentHomeServerUrl() {
  if (state.homeServerUrl) return state.homeServerUrl;
  if (location.protocol === "http:") return location.origin;
  return "";
}

function homeLibraryCatalogUrl() {
  const base = currentHomeServerUrl();
  return base ? new URL(CATALOG_URL, `${base}/`).href : "";
}

function homeLibraryBookUrl(book) {
  if (!book?.file) return "";
  try {
    return new URL(book.file, `${currentHomeServerUrl() || location.origin}/`).href;
  } catch {
    return "";
  }
}

async function fetchHomeLibrary(url, init = {}) {
  const options = {
    cache: "no-store",
    mode: "cors",
    ...init
  };
  if (url.startsWith("http://")) {
    options.targetAddressSpace = "local";
  }
  return fetch(url, options);
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
    await refreshCatalog();
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
  renderCatalog();
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

async function refreshCatalog() {
  const catalogUrl = homeLibraryCatalogUrl();
  if (!catalogUrl) {
    state.catalogBooks = [];
    renderCatalog();
    return;
  }

  try {
    const response = await fetchHomeLibrary(`${catalogUrl}?t=${Date.now()}`);
    if (response.status === 404) {
      state.catalogBooks = [];
      renderCatalog();
      return;
    }

    if (!response.ok) {
      throw new Error(`Home Library failed: ${response.status}`);
    }

    const catalog = await response.json();
    state.catalogBooks = (Array.isArray(catalog.books) ? catalog.books : []).map(book => ({
      ...book,
      source: "home"
    }));
    state.lastHomeLibraryError = "";
    renderHomeServerState();
    renderCatalog();
  } catch (error) {
    console.warn(error);
    state.catalogBooks = [];
    state.lastHomeLibraryError = location.protocol === "https:" && currentHomeServerUrl().startsWith("http:")
      ? `Could not reach Home PC from this HTTPS app. Open ${currentHomeServerUrl()} directly while home, then save books there.`
      : "Could not reach Home PC. Saved books still work offline.";
    renderHomeServerState();
    renderCatalog();
    setStatus(state.lastHomeLibraryError);
  }
}

function renderCatalog() {
  els.catalogList.replaceChildren();
  updateSaveHomeBooksButton();

  if (!currentHomeServerUrl()) {
    const empty = document.createElement("p");
    empty.className = "book-meta";
    empty.textContent = "Set Home PC while you are on the same Wi-Fi.";
    els.catalogList.append(empty);
    return;
  }

  if (state.catalogBooks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "book-meta";
    empty.textContent = state.lastHomeLibraryError || "No Home Library books yet.";
    els.catalogList.append(empty);
    return;
  }

  const savedIds = new Set(state.books.map(book => book.id));
  for (const book of state.catalogBooks) {
    const row = document.createElement("div");
    row.className = "catalog-item";

    const detail = document.createElement("div");
    detail.className = "catalog-detail";
    detail.innerHTML = `
      <span class="book-title">${escapeHtml(book.title || "Untitled Book")}</span>
      <span class="book-meta">${book.pageCount || 0} pages${book.sizeBytes ? ` - ${formatBytes(book.sizeBytes)}` : ""}</span>
    `;

    const action = document.createElement("button");
    action.type = "button";
    const saved = savedIds.has(book.id);
    action.textContent = saved ? "Open" : "Save";
    action.className = saved ? "ghost-button" : "primary-button";
    action.addEventListener("click", () => saved ? openBook(book.id) : saveCatalogBook(book));

    const actions = document.createElement("div");
    actions.className = "catalog-actions";
    actions.append(action);

    row.append(detail, actions);
    els.catalogList.append(row);
  }
  updateSaveHomeBooksButton();
}

async function saveCatalogBook(catalogBook) {
  if (!catalogBook?.file) {
    setStatus("Home Library book is missing its file URL.");
    return;
  }

  try {
    setStatus(`Saving ${catalogBook.title || "book"}...`);
    const sourceUrl = homeLibraryBookUrl(catalogBook);
    const response = await fetchHomeLibrary(sourceUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const blob = await response.blob();
    const fileName = sourceUrl.split("/").pop() || `${catalogBook.id || "book"}.abrbook`;
    const archive = await readZip(new File([blob], fileName));
    const manifest = await readJsonEntry(archive, "manifest.json");
    validateManifest(manifest);
    await storeBook({ name: fileName }, manifest, archive, {
      source: "home",
      sourceUrl
    });
    await refreshLibrary();
    await openBook(manifest.id);
    setStatus(`Saved ${manifest.title} to this phone.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Could not save Home Library book.");
  }
}

async function uploadHomeLibraryBook(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    setStatus(`Adding ${file.name} to Home Library...`);
    const archive = await readZip(file);
    const manifest = await readJsonEntry(archive, "manifest.json");
    validateManifest(manifest);

    const uploadUrl = new URL("api/books", `${currentHomeServerUrl()}/`).href;
    const metadata = encodeBase64Json({
      id: manifest.id,
      title: manifest.title || file.name.replace(/\.abrbook$/i, ""),
      author: manifest.author || "",
      pageCount: manifest.pageCount || manifest.pages?.length || 0
    });
    const response = await fetchHomeLibrary(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Book-Metadata": metadata,
        "X-Book-File-Name": encodeURIComponent(file.name)
      },
      body: file
    });
    if (!response.ok) {
      throw new Error(`Home Library add failed: ${response.status}`);
    }

    await refreshCatalog();
    setStatus(`Added ${manifest.title || file.name} to Home Library.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || `Could not add ${file.name} to Home Library.`);
  }
}

async function saveUnsavedHomeBooks() {
  const savedIds = new Set(state.books.map(book => book.id));
  const unsaved = state.catalogBooks.filter(book => !savedIds.has(book.id));
  if (!unsaved.length) {
    setStatus("Home Library books are already saved.");
    return;
  }

  els.saveHomeBooksButton.disabled = true;
  try {
    for (const book of unsaved) {
      await saveCatalogBook(book);
    }
    setStatus(unsaved.length === 1 ? "Saved Home Library book to this phone." : `Saved ${unsaved.length} Home Library books to this phone.`);
  } finally {
    updateSaveHomeBooksButton();
  }
}

function updateSaveHomeBooksButton() {
  const savedIds = new Set(state.books.map(book => book.id));
  const unsavedCount = state.catalogBooks.filter(book => !savedIds.has(book.id)).length;
  els.saveHomeBooksButton.disabled = unsavedCount === 0;
  els.saveHomeBooksButton.textContent = unsavedCount > 1 ? "Save All" : "Save";
}

function encodeBase64Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
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
  const castBible = state.currentManifest.voiceCastPath
    ? await readStoredJson(state.currentBook.id, state.currentManifest.voiceCastPath).catch(() => null)
    : null;
  const voicePlan = manifestPage.voiceCastPath
    ? await readStoredJson(state.currentBook.id, manifestPage.voiceCastPath).catch(() => null)
    : null;
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
  const speakers = buildSpeakers(castBible, voicePlan);
  state.currentPage = {
    manifestPage,
    text: pageJson.text || "",
    timings: Array.isArray(timings) ? timings : [],
    voicePlan,
    speakers,
    duration: manifestPage.durationSeconds || 0
  };
  state.currentWordIndex = -1;
  state.currentSentenceId = "";

  els.emptyState.hidden = true;
  els.pageView.hidden = false;
  els.bookTitle.textContent = state.currentManifest.title;
  els.pageLabel.textContent = `Page ${pageNumber} / ${state.currentManifest.pageCount}`;
  els.pageImage.hidden = !imageUrl;
  els.pageImage.src = imageUrl;
  els.pageImage.alt = imageUrl ? `Generated image for page ${pageNumber}` : "";
  renderSpeakerLegend(speakers);
  els.textView.innerHTML = renderText(state.currentPage.text, state.currentPage.timings, speakers, voicePlan);
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

function onTextViewClick(event) {
  const word = event.target.closest?.(".word");
  if (!word || !els.textView.contains(word)) return;
  showDefinitionForWord(word);
}

function seekToWordIndex(wordIndex) {
  if (!state.currentBook || !state.currentPage) return;
  const timing = state.currentPage.timings.find(item => Number(item.index) === Number(wordIndex));
  if (!timing) return;
  const duration = els.audio.duration || state.currentPage.duration || 1;
  els.audio.currentTime = clamp(Number(timing.startSeconds) || 0, 0, duration);
  updateFromAudio();
  saveReadingState();
  setStatus(`Moved audio to word ${Number(wordIndex) + 1}.`);
}

async function showDefinitionForWord(wordElement) {
  const rawWord = wordElement.textContent || "";
  const word = normalizeLookupWord(rawWord);
  if (!word) return;

  state.definitionWordIndex = Number(wordElement.dataset.index) || 0;
  els.definitionWord.textContent = word;
  els.definitionContext.textContent = contextAroundWord(wordElement);
  els.definitionResults.innerHTML = `<p class="book-meta">Looking up ${escapeHtml(word)}...</p>`;
  els.definitionSeekButton.disabled = false;

  if (!els.definitionDialog.open && typeof els.definitionDialog.showModal === "function") {
    els.definitionDialog.showModal();
  } else {
    els.definitionDialog.open = true;
  }

  try {
    const entries = await lookupDefinition(word);
    renderDefinitionResults(word, entries);
  } catch (error) {
    console.warn(error);
    els.definitionResults.innerHTML = `
      <p class="book-meta">Definition lookup needs internet and did not find ${escapeHtml(word)} right now.</p>
    `;
  }
}

function normalizeLookupWord(value) {
  return String(value || "")
    .replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "")
    .replace(/'{2,}/g, "'")
    .trim()
    .toLowerCase();
}

function contextAroundWord(wordElement) {
  const sentenceId = wordElement.dataset.sentenceId;
  const words = Array.from(els.textView.querySelectorAll(sentenceId
    ? `.word[data-sentence-id="${sentenceId}"]`
    : ".word"));
  const sentence = words.map(word => word.textContent).join(" ").replace(/\s+([,.;:!?])/g, "$1");
  if (sentence.length <= 180) return sentence;
  const index = words.indexOf(wordElement);
  const slice = words.slice(Math.max(0, index - 8), Math.min(words.length, index + 9));
  return slice.map(word => word.textContent).join(" ").replace(/\s+([,.;:!?])/g, "$1");
}

async function lookupDefinition(word) {
  const response = await fetch(`${DICTIONARY_API_URL}${encodeURIComponent(word)}`);
  if (!response.ok) throw new Error(`Definition failed: ${response.status}`);
  return response.json();
}

function renderDefinitionResults(word, entries) {
  const senses = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const meaning of entry.meanings || []) {
      for (const item of meaning.definitions || []) {
        if (!item.definition) continue;
        senses.push({
          partOfSpeech: meaning.partOfSpeech || "",
          definition: item.definition,
          example: item.example || ""
        });
      }
    }
  }

  if (!senses.length) {
    els.definitionResults.innerHTML = `<p class="book-meta">No definition found for ${escapeHtml(word)}.</p>`;
    return;
  }

  els.definitionResults.innerHTML = senses.slice(0, 4).map(sense => `
    <section class="definition-sense">
      ${sense.partOfSpeech ? `<strong>${escapeHtml(sense.partOfSpeech)}</strong>` : ""}
      <p>${escapeHtml(sense.definition)}</p>
      ${sense.example ? `<q>${escapeHtml(sense.example)}</q>` : ""}
    </section>
  `).join("");
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
  for (const word of els.textView.querySelectorAll(".word.sentence-current")) {
    word.classList.remove("sentence-current");
  }
  state.currentWordIndex = nextIndex;

  for (const word of els.textView.querySelectorAll(".word")) {
    const wordIndex = Number(word.dataset.index);
    word.classList.toggle("read", wordIndex < nextIndex);
  }

  const current = els.textView.querySelector(`.word[data-index="${nextIndex}"]`);
  if (current) {
    current.classList.add("current");
    state.currentSentenceId = current.dataset.sentenceId || "";
    if (state.currentSentenceId) {
      for (const word of els.textView.querySelectorAll(`.word[data-sentence-id="${state.currentSentenceId}"]`)) {
        word.classList.add("sentence-current");
      }
    }
    updateSpeakerNow(current.dataset.speaker || "", current.dataset.speakerName || "");
    current.scrollIntoView({ block: "center", behavior: "smooth" });
  } else {
    state.currentSentenceId = "";
    updateSpeakerNow("", "");
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
  const settings = readLocalJson(SETTINGS_KEY, { showImages: true, readerFont: "serif" });
  return {
    showImages: settings.showImages !== false,
    readerFont: normalizeReaderFont(settings.readerFont)
  };
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applyReaderFont(font) {
  els.textView.dataset.readerFont = normalizeReaderFont(font);
}

function normalizeReaderFont(font) {
  return ["serif", "system", "georgia", "palatino", "verdana", "comic"].includes(font) ? font : "serif";
}

function readLocalJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function storeBook(sourceFile, manifest, archive, options = {}) {
  const book = {
    id: manifest.id,
    title: manifest.title || sourceFile.name,
    author: manifest.author || "",
    pageCount: manifest.pageCount || manifest.pages?.length || 0,
    sourceName: sourceFile.name,
    source: options.source || "file",
    sourceUrl: options.sourceUrl || "",
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
  await deleteBookFromDevice(bookId);
  clearReader();
  await refreshLibrary();
  setStatus("Book deleted from this device.");
}

async function deleteBookFromDevice(bookId) {
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

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
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

function renderText(text, timings, speakers = new Map(), voicePlan = null) {
  if (!Array.isArray(timings) || timings.length === 0) {
    return textBlocks(text).map((block, index) =>
      `<${blockTag(block.text, index)}>${escapeHtml(normalizeWhitespace(block.text))}</${blockTag(block.text, index)}>`
    ).join("");
  }

  const sentenceBoundaries = buildSentenceBoundaries(text);
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
      const segment = segmentForTiming(timing, voicePlan);
      const speaker = speakerForSegment(segment, speakers);
      const wordIndex = Number(timing.index) || 0;
      const sentenceId = sentenceIdForOffset(sentenceBoundaries, timing.textOffset);
      const kind = segment?.kind || speaker.kind || "narration";
      html += [
        `<span class="word"`,
        ` data-index="${wordIndex}"`,
        ` data-start="${Number(timing.startSeconds) || 0}"`,
        ` data-segment-id="${escapeHtml(segment?.id || "")}"`,
        ` data-sentence-id="${sentenceId}"`,
        ` data-kind="${escapeHtml(kind)}"`,
        ` data-speaker="${escapeHtml(speaker.id)}"`,
        ` data-speaker-name="${escapeHtml(speaker.name)}"`,
        ` style="--speaker-color: ${escapeHtml(speaker.color)}"`,
        `>${escapeHtml(wordText)}</span>`
      ].join("");
      cursor = Math.max(cursor, end);
    }

    if (cursor < blockEnd) {
      html += escapeHtml(normalizeWhitespace(text.slice(cursor, blockEnd)));
    }

    return `<${tag}>${html}</${tag}>`;
  }).join("");
}

function buildSpeakers(castBible, voicePlan) {
  const speakers = new Map();
  const addSpeaker = (id, speaker = {}, index = speakers.size) => {
    const key = String(id || speaker.id || speaker.speakerId || `speaker-${index}`);
    if (!key || speakers.has(key)) return;
    const role = String(speaker.role || speaker.kind || "").toLowerCase();
    const name = speaker.name || speaker.speakerName || (role === "narrator" ? "Narrator" : key);
    speakers.set(key, {
      id: key,
      name,
      kind: role || "dialogue",
      voiceName: speaker.voiceName || "",
      color: speaker.color || colorForSpeaker(key, index, role)
    });
  };

  if (castBible?.narrator) {
    addSpeaker(castBible.narrator.id || "narrator", castBible.narrator, 0);
  }

  const characters = Array.isArray(castBible?.characters) ? castBible.characters : [];
  characters.forEach((speaker, index) => addSpeaker(speaker.id, speaker, index + 1));

  const segments = Array.isArray(voicePlan?.segments) ? voicePlan.segments : [];
  for (const segment of segments) {
    if (!segment?.speakerId) continue;
    addSpeaker(segment.speakerId, {
      name: segment.speakerName,
      voiceName: segment.voiceName,
      color: segment.color,
      kind: segment.kind
    });
  }

  if (!speakers.size && segments.length) {
    addSpeaker("narrator", { name: "Narrator", kind: "narration" }, 0);
  }

  return speakers;
}

function colorForSpeaker(id, index, role = "") {
  if (role === "narrator" || id === "narrator") return NARRATOR_COLOR;
  const hash = Array.from(String(id || index)).reduce((total, char) => total + char.charCodeAt(0), 0);
  return SPEAKER_COLORS[(hash + index) % SPEAKER_COLORS.length] || FALLBACK_COLOR;
}

function segmentForTiming(timing, voicePlan) {
  const segments = Array.isArray(voicePlan?.segments) ? voicePlan.segments : [];
  if (!segments.length) return null;

  const offset = Number(timing.textOffset) || 0;
  const midpoint = offset + Math.max(1, Number(timing.textLength) || 1) / 2;
  return segments.find(segment => {
    const start = Number(segment.textOffset) || 0;
    const length = Math.max(0, Number(segment.textLength) || 0);
    const end = start + length;
    return midpoint >= start && midpoint <= end;
  }) || segments.find(segment => {
    const start = Number(segment.textOffset) || 0;
    const length = Math.max(0, Number(segment.textLength) || 0);
    return offset >= start && offset <= start + length;
  }) || null;
}

function speakerForSegment(segment, speakers) {
  if (segment?.speakerId && speakers.has(String(segment.speakerId))) {
    return speakers.get(String(segment.speakerId));
  }

  const fallbackId = segment?.kind === "dialogue" ? "speaker" : "narrator";
  return speakers.get(fallbackId) || {
    id: fallbackId,
    name: segment?.speakerName || (fallbackId === "narrator" ? "Narrator" : "Speaker"),
    kind: segment?.kind || "narration",
    voiceName: segment?.voiceName || "",
    color: segment?.color || (fallbackId === "narrator" ? NARRATOR_COLOR : FALLBACK_COLOR)
  };
}

function renderSpeakerLegend(speakers) {
  els.speakerLegend.replaceChildren();
  if (!speakers?.size) {
    els.speakerLegend.hidden = true;
    return;
  }

  const now = document.createElement("div");
  now.className = "speaker-now";
  now.textContent = "Speaking: -";
  els.speakerLegend.append(now);

  for (const speaker of speakers.values()) {
    const chip = document.createElement("span");
    chip.className = "speaker-chip";
    chip.dataset.speaker = speaker.id;
    chip.style.setProperty("--speaker-color", speaker.color);
    chip.innerHTML = `
      <span class="speaker-swatch" aria-hidden="true"></span>
      <span>${escapeHtml(speaker.name)}</span>
    `;
    if (speaker.voiceName) {
      chip.title = speaker.voiceName;
    }
    els.speakerLegend.append(chip);
  }

  els.speakerLegend.hidden = false;
}

function updateSpeakerNow(speakerId, speakerName) {
  if (!els.speakerLegend || els.speakerLegend.hidden) return;
  const label = els.speakerLegend.querySelector(".speaker-now");
  if (label) {
    label.textContent = speakerName ? `Speaking: ${speakerName}` : "Speaking: -";
  }

  for (const chip of els.speakerLegend.querySelectorAll(".speaker-chip")) {
    chip.classList.toggle("active", Boolean(speakerId) && chip.dataset.speaker === speakerId);
  }
}

function buildSentenceBoundaries(text) {
  const boundaries = [];
  let start = 0;
  let id = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] || "";
    if (/[.!?]/.test(char) && (next === "" || /\s|["')\]]/.test(next))) {
      boundaries.push({ id: String(id), start, end: index + 1 });
      id += 1;
      start = index + 1;
    }
  }
  if (start < text.length) {
    boundaries.push({ id: String(id), start, end: text.length });
  }
  return boundaries;
}

function sentenceIdForOffset(boundaries, offset) {
  const hit = boundaries.find(sentence => offset >= sentence.start && offset < sentence.end);
  return hit?.id || "0";
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
