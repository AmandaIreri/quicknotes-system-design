// QuickNotes API client.
// Talks to the JSONPlaceholder practice API (a fake REST API):
// https://jsonplaceholder.typicode.com/

const API_URL = "https://jsonplaceholder.typicode.com/posts";

const loadBtn    = document.querySelector("#load-btn");
const statusText = document.querySelector("#status");
const notesList  = document.querySelector("#notes-list");
const noteForm   = document.querySelector("#note-form");
const titleInput = document.querySelector("#title-input");
const bodyInput  = document.querySelector("#body-input");
const submitBtn  = document.querySelector("#submit-btn");

// The notes currently shown on the page.
// JSONPlaceholder answers every POST with the same id (101), so we keep the
// note objects themselves and remove by reference instead of by id.
let notes = [];

// Number of requests in flight. While this is above zero, every
// button on the page is disabled (checklist: "buttons disabled while
// requests run").
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
  const busy = pendingRequests > 0;
  loadBtn.disabled = busy;
  submitBtn.disabled = busy;
  for (const button of notesList.querySelectorAll(".delete-btn")) {
    button.disabled = busy;
  }
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

async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  // 204 No Content, and JSONPlaceholder's empty DELETE body, both give "".
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

  const footer = document.createElement("div");
  footer.classList.add("note-footer");

  const meta = document.createElement("span");
  meta.classList.add("note-meta");
  meta.textContent = note.createdHere
    ? `id ${note.id} · new in this session`
    : `id ${note.id}`;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.classList.add("delete-btn");
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => deleteNote(note));

  footer.append(meta, deleteBtn);
  li.append(title, body, footer);

  return li;
}

function renderNotes() {
  notesList.replaceChildren();

  if (notes.length === 0) {
    const empty = document.createElement("li");
    empty.classList.add("empty");
    empty.textContent = "No notes to show yet. Load notes or write your first one.";
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
/* POST - create a note                                                */
/* ------------------------------------------------------------------ */

async function createNote(event) {
  event.preventDefault();

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();

  // Validation: title required, max 100 characters. Body is optional.
  if (!title) {
    setStatus("A title is required before saving.", "error");
    titleInput.focus();
    return;
  }

  if (title.length > 100) {
    setStatus("The title must be 100 characters or fewer.", "error");
    titleInput.focus();
    return;
  }

  setStatus("Saving note...");
  beginRequest();

  try {
    const { status, data: created } = await request(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, userId: 1 }),
    });

    // JSONPlaceholder does not really save posts: it always answers
    // 201 with id 101. We still add the returned note to the top of the
    // list so the UI behaves the way it will against the real API, and we
    // tag it as createdHere so DELETE can explain the difference later.
    if (created) {
      created.createdHere = true;
      notes.unshift(created);
      renderNotes();
    }

    noteForm.reset();
    titleInput.focus();

    const id = created ? created.id : "unknown";
    setStatus(`Note created (status ${status}, id ${id}).`, "success");
  } catch (error) {
    console.error(error);
    setStatus("Could not create the note. Please try again.", "error");
  } finally {
    endRequest();
  }
}

/* ------------------------------------------------------------------ */
/* DELETE - remove a note                                              */
/* ------------------------------------------------------------------ */

async function deleteNote(note) {
  setStatus(`Deleting note ${note.id}...`);
  beginRequest();

  try {
    await request(`${API_URL}/${note.id}`, { method: "DELETE" });

    notes = notes.filter((item) => item !== note);
    renderNotes();
    setStatus(`Note ${note.id} deleted.`, "success");
  } catch (error) {
    console.error(error);

    // JSONPlaceholder never actually stores the notes we POST, so deleting
    // one answers 404. Rather than show a scary error for a note that was
    // never on the server, we remove it from the page and say why.
    if (note.createdHere && error.status === 404) {
      notes = notes.filter((item) => item !== note);
      renderNotes();
      setStatus(
        `Note ${note.id} only existed in this browser session, so it was removed from the list.`,
        "success"
      );
    } else {
      setStatus(`Could not delete note ${note.id}. Please try again.`, "error");
    }
  } finally {
    endRequest();
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

loadBtn.addEventListener("click", loadNotes);
noteForm.addEventListener("submit", createNote);