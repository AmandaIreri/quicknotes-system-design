// QuickNotes API client.
// Talks to the JSONPlaceholder practice API (a fake REST API):
// https://jsonplaceholder.typicode.com/

const API_URL = "https://jsonplaceholder.typicode.com/posts";

const loadBtn    = document.querySelector("#load-btn");
const statusText = document.querySelector("#status");
const notesList  = document.querySelector("#notes-list");

// The notes currently shown on the page.
let notes = [];

// Number of requests in flight. While this is above zero, the
// load button is disabled (checklist: "buttons disabled while requests run").
let pendingRequests = 0;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

// Always textContent - never innerHTML - so API text can never inject markup.
function setStatus(message, type = "") {
  statusText.textContent = message;
  statusText.classList.remove("success", "error");
  if (type) {
    statusText.classList.add(type);
  }
}

function updateControls() {
  loadBtn.disabled = pendingRequests > 0;
}

function beginRequest() {
  pendingRequests += 1;
  updateControls();
}

function endRequest() {
  pendingRequests = Math.max(0, pendingRequests - 1);
  updateControls();
}

/* ------------------------------------------------------------------ */
/* The one reusable fetch wrapper                                      */
/* ------------------------------------------------------------------ */

// Calls fetch, throws on any non-2xx response, and returns
// { status, data } so callers can report the real status code.
async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  // 204 No Content bodies come back as "" - guard against JSON.parse("").
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  return { status: response.status, data };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function createNoteCard(note) {
  const li = document.createElement("li");
  li.classList.add("note");

  const title = document.createElement("h3");
  title.textContent = note.title;

  const body = document.createElement("p");
  body.classList.add("note-body");
  body.textContent = note.body ? note.body : "No body text.";

  const meta = document.createElement("span");
  meta.classList.add("note-meta");
  meta.textContent = `id ${note.id}`;

  li.append(title, body, meta);
  return li;
}

function renderNotes() {
  notesList.replaceChildren();

  if (notes.length === 0) {
    const empty = document.createElement("li");
    empty.classList.add("empty");
    empty.textContent = "No notes to show yet. Load notes to fetch them.";
    notesList.appendChild(empty);
    updateControls();
    return;
  }

  for (const note of notes) {
    notesList.appendChild(createNoteCard(note));
  }

  updateControls();
}

/* ------------------------------------------------------------------ */
/* GET - load 10 notes                                                 */
/* ------------------------------------------------------------------ */

async function loadNotes() {
  setStatus("Loading notes...");
  beginRequest();

  try {
    const { data } = await request(`${API_URL}?_limit=10`);
    notes = Array.isArray(data) ? data : [];
    renderNotes();

    if (notes.length === 0) {
      setStatus("The server returned no notes.", "success");
    } else {
      setStatus(`Loaded ${notes.length} notes from the server.`, "success");
    }
  } catch (error) {
    console.error(error);
    setStatus("Could not load notes. Please check your connection and try again.", "error");
  } finally {
    endRequest();
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

loadBtn.addEventListener("click", loadNotes);