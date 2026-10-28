# QuickNotes Data Model

Four tables: `users`, `notes`, `tags` and `note_tags`. PostgreSQL, because
the data is highly relational and the queries are predictable.

## Entities and columns

### `users`

| Column          | Type          | Key | Notes                          |
|-----------------|---------------|-----|--------------------------------|
| `id`            | BIGSERIAL     | PK  |                                |
| `email`         | VARCHAR(255)  |     | Unique, used to sign in        |
| `password_hash` | VARCHAR(255)  |     | Never store the plain password |
| `display_name`  | VARCHAR(80)   |     |                                |
| `created_at`    | TIMESTAMPTZ   |     | Defaults to `now()`            |
| `updated_at`    | TIMESTAMPTZ   |     | Defaults to `now()`            |

### `notes`

| Column       | Type          | Key | Notes                                    |
|--------------|---------------|-----|------------------------------------------|
| `id`         | BIGSERIAL     | PK  |                                          |
| `user_id`    | BIGINT        | FK → `users.id` | Owner; `ON DELETE CASCADE`     |
| `title`      | VARCHAR(100)  |     | Required, 1–100 characters               |
| `body`       | TEXT          |     | Optional, defaults to `''`               |
| `created_at` | TIMESTAMPTZ   |     | Defaults to `now()`                      |
| `updated_at` | TIMESTAMPTZ   |     | Defaults to `now()`                      |

### `tags`

| Column       | Type         | Key | Notes                            |
|--------------|--------------|-----|----------------------------------|
| `id`         | BIGSERIAL    | PK  |                                  |
| `name`       | VARCHAR(50)  |     | Unique per user (e.g. "work")    |
| `created_at` | TIMESTAMPTZ  |     | Defaults to `now()`              |

### `note_tags` (junction table)

| Column    | Type   | Key | Notes                                    |
|-----------|--------|-----|------------------------------------------|
| `note_id` | BIGINT | PK, FK → `notes.id` (`ON DELETE CASCADE`) | Part of the composite primary key |
| `tag_id`  | BIGINT | PK, FK → `tags.id`  (`ON DELETE CASCADE`) | Part of the composite primary key |

## Relationships

**One-to-many (users → notes).** One user owns many notes; each note belongs
to exactly one user. This is why `notes.user_id` is a foreign key and why
every query filters on `user_id` — a note is never visible to another user.

**Many-to-many (notes ↔ tags).** A note can carry several tags, and one tag
(e.g. "work") can appear on many notes. A relational database cannot store a
list inside a column, so the relationship is modelled with the junction
table `note_tags`: one row per (note, tag) pair. Its composite primary key
`(note_id, tag_id)` makes duplicates impossible.

## CREATE TABLE statements

```sql
CREATE TABLE users (
  id            BIGSERIAL    PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(80)  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE notes (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      VARCHAR(100) NOT NULL,
  body       TEXT         NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT notes_title_not_blank CHECK (length(trim(title)) > 0)
);

CREATE TABLE tags (
  id         BIGSERIAL   PRIMARY KEY,
  name       VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE note_tags (
  note_id BIGINT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  tag_id  BIGINT NOT NULL REFERENCES tags  (id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
```

## Indexes

```sql
-- The main screen: "my notes, newest first". One composite index serves
-- both the WHERE and the ORDER BY, so no sort step is needed.
CREATE INDEX notes_user_created_idx
  ON notes (user_id, created_at DESC);

-- The composite PK on note_tags is (note_id, tag_id), which cannot serve
-- the reverse lookup "all notes with tag 3". This index can.
CREATE INDEX note_tags_tag_id_idx
  ON note_tags (tag_id);
```

Reason: without `notes_user_created_idx`, every note-list request would scan
all notes and then sort them in memory; the index turns it into a direct
range scan that already comes back in order. The tag index makes filtering
by tag (`GET /notes?tag=work`) an index lookup instead of a full scan.

## Example queries

**1. A user's ten newest notes** (the main screen):

```sql
SELECT id, title, body, created_at
FROM notes
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 10;
```

**2. Title search inside one user's notes:**

```sql
SELECT id, title, created_at
FROM notes
WHERE user_id = $1
  AND title ILIKE '%' || $2 || '%'
ORDER BY created_at DESC;
```

**3. JOIN — notes with their tag names** (the note list with tags shown):

```sql
SELECT n.id, n.title, n.created_at, t.name AS tag
FROM notes AS n
LEFT JOIN note_tags AS nt ON nt.note_id = n.id
LEFT JOIN tags      AS t  ON t.id = nt.tag_id
WHERE n.user_id = $1
ORDER BY n.created_at DESC, t.name;
```

`LEFT JOIN` (not `JOIN`) so that notes without any tags still appear.

**4. JOIN — how many notes each user has:**

```sql
SELECT u.id, u.display_name, COUNT(n.id) AS note_count
FROM users AS u
LEFT JOIN notes AS n ON n.user_id = u.id
GROUP BY u.id, u.display_name
ORDER BY note_count DESC;
```

**5. All of a user's notes carrying a tag:**

```sql
SELECT n.id, n.title
FROM notes AS n
JOIN note_tags AS nt ON nt.note_id = n.id
JOIN tags      AS t  ON t.id = nt.tag_id
WHERE n.user_id = $1 AND t.name = $2;
```

## SQL or NoSQL?

QuickNotes stores small, highly relational records: a note belongs to exactly
one user, tags are shared across many notes, and almost every screen is a
join or a filtered list by `user_id`. Consistency also matters — one user
must never see another user's note, and a deleted note must actually be gone.
A relational database gives us those guarantees for free with foreign keys,
`ON DELETE CASCADE` and a single source of truth. At one million users the
volume is small (about 1 GB of new notes per day, under half a terabyte a
year) and the read load is roughly 40 queries per second on average, so a
single primary plus read replicas is plenty — there is no sharding-sized
problem here. A document store like MongoDB would only pay off if notes were
large, deeply nested, schema-less documents with no cross-entity queries; but
because tags are shared, a document model would either duplicate tag names on
every note or push joins into application code. **PostgreSQL is the right
call**, with the option to move full-text search to a dedicated index later.