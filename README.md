# QuickNotes — API Client & System Design

The second QuickNotes project: a working front-end **API client** that talks
to a real REST API (JSONPlaceholder) with `fetch()`, plus the design
documents the backend team will build the production service from.

## What is in this repository

```
index.html           the page: load button, note form, notes list, status line
api.js               the API client: GET, POST, DELETE, validation, states
style.css            readable styling with distinct success / error states
docs/api-design.md   the REST API the backend team should build
docs/data-model.md   tables, relationships, SQL, indexes, SQL vs NoSQL
docs/architecture.md requirements, load estimate, diagram, flows, trade-offs
```

## How to run the API client

1. Clone the repository:

   ```bash
   git clone https://github.com/AmandaIreri/quicknotes-system-design.git
   cd quicknotes-system-design
   ```

2. Open `index.html` in a browser — double-click it, or serve the folder:

   ```bash
   python3 -m http.server 8000
   # then visit http://localhost:8000
   ```

3. Click **Load notes** to fetch `GET /posts?_limit=10`.
4. Type a title (required, max 100 characters) and optionally a body, then
   click **Save note** to send `POST /posts`.
5. Click **Delete** on any note to send `DELETE /posts/{id}`.

No build step, no dependencies, no API key.

### About JSONPlaceholder

JSONPlaceholder is a **practice** API. It answers `POST` with `201` and
`id: 101` but does not actually save anything, so:

- every note you create is shown in the list only for this browser session,
- deleting a note you just created returns `404` from the server, and the
  client removes it from the list anyway and explains why in the status line.

Both behaviours are handled in `api.js` with code comments.

## Design documents

- [API design](docs/api-design.md)
- [Data model](docs/data-model.md)
- [Architecture](docs/architecture.md)

## What I learned

1. **A single `request()` wrapper pays for itself.** Checking `response.ok`
   in one place means every caller gets the same error behaviour, and
   attaching the status code to the thrown error let me show real status
   messages ("Note created (status 201, id 101)") without duplicating logic.

2. **Disabled buttons and `finally` belong together.** Putting
   `endRequest()` in `finally` means the UI re-enables itself on success,
   on failure and on a thrown validation error — the one place where a
   forgotten `finally` would leave the page permanently frozen.

3. **The empty state is a real state.** Rendering "No notes to show yet"
   *inside* the list (rather than leaving a blank `<ul>`) makes the page
   understandable when the API returns `[]`, and it costs three lines.

4. **Read-heavy designs are shaped by the read path.** The load estimate
   (40 reads/s vs 10 writes/s) showed the effort belongs in the CDN, the
   cache and read replicas, not in making writes clever.

5. **Every design decision has a named cost.** Caching buys speed with
   staleness, replicas buy availability with eventual consistency, a
   monolith buys simplicity with a lower ceiling. Writing the trade-off
   down is part of the design, not an afterthought.