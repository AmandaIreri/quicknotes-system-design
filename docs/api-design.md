# QuickNotes API Design

The REST API the backend team will build for QuickNotes. Every request and
response body is JSON, every resource lives under `/notes`, and every call
must be authenticated with a bearer token.

- **Base URL:** `https://api.quicknotes.example/v1`
- **Auth header:** `Authorization: Bearer <token>`

## The note resource

| Field       | Type              | Rules                                        |
|-------------|-------------------|----------------------------------------------|
| `id`        | number            | Assigned by the server                       |
| `userId`    | number            | Owner; taken from the token, never the body  |
| `title`     | string            | **Required**, 1–100 characters               |
| `body`      | string            | Optional, may be empty                       |
| `tags`      | string[]          | Optional list of tag names                   |
| `createdAt` | string (ISO 8601) | Set by the server                            |
| `updatedAt` | string (ISO 8601) | Set by the server                            |

Example note:

```json
{
  "id": 42,
  "userId": 7,
  "title": "Grocery list",
  "body": "Milk, eggs, flour, tomatoes",
  "tags": ["shopping", "home"],
  "createdAt": "2026-02-11T09:14:00Z",
  "updatedAt": "2026-02-11T09:14:00Z"
}
```

## Endpoints

| # | Method | Path                        | Description                                                    | Success |
|---|--------|-----------------------------|----------------------------------------------------------------|---------|
| 1 | GET    | `/notes`                    | List the signed-in user's notes, newest first (paginated).     | 200 OK  |
| 2 | GET    | `/notes/{id}`               | Return a single note owned by the signed-in user.              | 200 OK  |
| 3 | POST   | `/notes`                    | Create a note for the signed-in user; the server assigns `id`. | 201 Created |
| 4 | PUT    | `/notes/{id}`               | Replace the whole note. Every field must be sent.              | 200 OK  |
| 5 | PATCH  | `/notes/{id}`               | Update only the fields that are sent (e.g. rename a note).     | 200 OK  |
| 6 | DELETE | `/notes/{id}`               | Delete the note permanently.                                   | 204 No Content |
| 7 | GET    | `/notes?tag=work`           | List the user's notes carrying a given tag.                    | 200 OK  |
| 8 | GET    | `/notes?limit=10&offset=0`  | Same as #1 with explicit pagination.                           | 200 OK  |

### 1. List notes — `GET /notes?limit=10&offset=0`

**Request body:** none.

**Response — 200 OK:**

```json
{
  "data": [
    {
      "id": 42,
      "userId": 7,
      "title": "Grocery list",
      "body": "Milk, eggs, flour, tomatoes",
      "tags": ["shopping", "home"],
      "createdAt": "2026-02-11T09:14:00Z",
      "updatedAt": "2026-02-11T09:14:00Z"
    },
    {
      "id": 41,
      "userId": 7,
      "title": "Stand-up notes",
      "body": "Ship the API client this week.",
      "tags": ["work"],
      "createdAt": "2026-02-10T08:02:00Z",
      "updatedAt": "2026-02-10T08:02:00Z"
    }
  ],
  "meta": { "count": 2, "limit": 10, "offset": 0, "total": 42 }
}
```

### 3. Create a note — `POST /notes`

**Request:**

```json
{
  "title": "Grocery list",
  "body": "Milk, eggs, flour, tomatoes",
  "tags": ["shopping", "home"]
}
```

The server ignores any `userId` in the body and takes the owner from the
token — a user can never create a note for someone else.

**Response — 201 Created:**

```json
{
  "id": 42,
  "userId": 7,
  "title": "Grocery list",
  "body": "Milk, eggs, flour, tomatoes",
  "tags": ["shopping", "home"],
  "createdAt": "2026-02-11T09:14:00Z",
  "updatedAt": "2026-02-11T09:14:00Z"
}
```

## Error format

Every error uses the same body shape:

```json
{
  "status": 400,
  "error": "Bad Request",
  "message": "title is required and must be between 1 and 100 characters.",
  "field": "title"
}
```

## Error status codes

| Code | Name                | When it happens                                                        |
|------|---------------------|------------------------------------------------------------------------|
| 400  | Bad Request         | Malformed JSON, missing `title`, blank `title`, `title` over 100 chars, `limit` not a number. |
| 401  | Unauthorized        | No `Authorization` header, or the token is expired/invalid.            |
| 403  | Forbidden           | Valid token, but the note belongs to another user.                     |
| 404  | Not Found           | No note with that `id`, or the URL does not exist.                     |
| 409  | Conflict            | A tag name that must be unique already exists for this user.           |
| 500  | Internal Server Error | An unexpected failure on our side; nothing the client did wrong.     |

Examples:

- `GET /notes/9999` → **404**, `{"status":404,"error":"Not Found","message":"Note 9999 does not exist."}`
- `POST /notes` with `{"body":"no title"}` → **400**, `{"status":400,"error":"Bad Request","message":"title is required and must be between 1 and 100 characters.","field":"title"}`
- `GET /notes/42` with no token → **401**, `{"status":401,"error":"Unauthorized","message":"Missing or invalid bearer token."}`
- `DELETE /notes/42` where note 42 belongs to user 9 → **403**, `{"status":403,"error":"Forbidden","message":"You do not have access to this note."}`