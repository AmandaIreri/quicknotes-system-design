# QuickNotes Architecture

How QuickNotes runs as a real online service for **1,000,000 registered
users** — requirements, load estimate, diagram, component explanations,
request flows and trade-offs.

## 1. Requirements

### Functional requirements

1. A user can sign up, sign in and stay signed in.
2. A signed-in user can create a note with a title (required, ≤ 100 chars)
   and an optional body.
3. A user can list their own notes, newest first, with pagination.
4. A user can open, edit, tag and delete their own notes.
5. A user can filter their notes by tag.
6. A user can never read or modify another user's notes.
7. Deleting a note removes it everywhere.

### Non-functional requirements

| Requirement   | Target |
|---------------|--------|
| Latency       | `GET /notes` p95 under 200 ms; `POST /notes` p95 under 300 ms |
| Availability  | 99.9% ("three nines", ≈ 8.8 h downtime/year) |
| Throughput    | 200 reads/s and 50 writes/s at peak (see §2) |
| Durability    | No acknowledged note is ever lost |
| Scalability   | Add app servers horizontally with no code change |
| Security      | HTTPS only, hashed passwords, per-user authorization on every request |
| Observability | Logs, metrics and alerts on error rate, latency and cache hit rate |
| Cost          | Stay on a handful of mid-size machines at launch |

## 2. Load estimate (1,000,000 users)

Assumptions:

- 1,000,000 registered users.
- 20% active on a given day → **200,000 daily active users (DAU)**.
- Each active user creates **5 notes/day**.
- Each active user loads their note list **20 times/day**.
- An average note (title + body + row overhead) is about **1 KB**.
- Rounding: 1 day ≈ 100,000 seconds; 1 KB = 1,000 B; 1 TB = 1,000 GB.
- Peak hours carry about **5×** the average traffic.

**Writes (new notes)**

- 200,000 × 5 = 1,000,000 notes/day
- 1,000,000 ÷ 100,000 = **10 writes/s average**
- Peak: **50 writes/s**

**Reads (note-list loads)**

- 200,000 × 20 = 4,000,000 loads/day
- 4,000,000 ÷ 100,000 = **40 reads/s average**
- Peak: **200 reads/s**

**Storage**

- 1,000,000 notes/day × 1 KB = 1,000,000 KB ≈ **1 GB/day**
- 1 GB × 365 ≈ **365 GB/year**

| Metric        | Average | Peak (5×) |
|---------------|---------|-----------|
| Writes/s      | 10      | 50        |
| Reads/s       | 40      | 200       |
| Storage/day   | ~1 GB   | —         |
| Storage/year  | ~365 GB | —         |

**What this tells us.** QuickNotes is **read-heavy — about 4 reads for every
write** — so the effort goes into the read path: a CDN for the static front
end, a Redis cache for assembled note lists, and read replicas for the
database. But the absolute numbers are modest: 200 reads/s and 365 GB/year
fit comfortably on a few ordinary servers plus one well-configured database.
There is no need for sharding or microservices yet — over-engineering would
be a mistake at this size.

## 3. Architecture diagram

```
                          ┌──────────┐
              ┌──────────>│   DNS    │  quicknotes.com → LB and CDN IPs
              │           └──────────┘
              │
   ┌──────────┴─────────┐   HTML / CSS / JS    ┌────────────────────────┐
   │ Browser / mobile   │─────────────────────>│  CDN (edge servers)    │
   │ client             │<─────────────────────│  Cloudflare / CloudFront│
   └──────────┬─────────┘                      └────────────────────────┘
              │  API calls: GET/POST/PATCH/DELETE /notes (HTTPS, JSON)
              v
      ┌────────────────┐
      │ Load balancer  │  health checks + round robin / least connections
      └───────┬────────┘
              │
     ┌────────┼───────────────┐
     v        v               v
 ┌───────┐ ┌───────┐      ┌───────┐        ┌──────────────────────────┐
 │ App 1 │ │ App 2 │      │ App 3 │───────>│ Redis cache              │
 └──┬────┘ └──┬────┘      └──┬────┘ cache- │ notes:user:{id}  (TTL 5m)│
    │         │              │      aside └──────────────────────────┘
    │ writes  │              │ reads
    v         │              v
 ┌──────────────────┐   ┌──────────────────┐
 │ Primary database │──>│ Read replica     │
 │ PostgreSQL       │   │ PostgreSQL       │
 └────────┬─────────┘   └──────────────────┘
          │ enqueue slow jobs
          v
 ┌──────────────────┐   ┌────────────────────────────┐
 │ Message queue    │──>│ Worker: welcome emails,    │
 │ (SQS / RabbitMQ) │   │ PDF export, tag re-index   │
 └──────────────────┘   └────────────────────────────┘
```

## 4. What each component solves

| Component | The problem it solves |
|-----------|-----------------------|
| **DNS** | Turns `quicknotes.com` into the IP addresses of the load balancer and the CDN, so the browser knows where to connect. |
| **CDN** | Serves `index.html`, `style.css` and `api.js` from an edge server near the user (20–40 ms instead of 200 ms from a distant origin) and absorbs static-file traffic before it reaches our servers. |
| **Load balancer** | Spreads API requests over several app servers and health-checks them, so a crashed server is dropped within seconds and the app tier can grow by adding machines. |
| **App servers (×3, stateless)** | Run the API code (auth, validation, note CRUD); because they hold no per-user state, any server can serve any request, which is exactly what the load balancer requires. |
| **Redis cache** | Keeps assembled note lists in RAM so a repeat `GET /notes` returns in ~1 ms instead of ~20 ms, which is how a few servers carry 200 reads/s. |
| **Primary database** | The single source of truth that accepts every write and enforces the schema, foreign keys and "one user cannot see another's notes" rule. |
| **Read replica** | Serves the many read queries so they never queue behind writes on the primary, and can be promoted to primary if the primary dies. |
| **Message queue** | Accepts slow jobs (welcome email, PDF export) instantly so the app server can answer the user immediately instead of waiting. |
| **Worker** | Pulls jobs off the queue and does the slow work in the background, smoothing bursts instead of overloading the request path. |

## 5. Request flow — `GET /notes`

1. The browser already has the cached front end from the CDN; it sends
   `GET /notes?limit=10` with its bearer token. DNS resolves
   `api.quicknotes.com` to the load balancer.
2. The **load balancer** picks the least-busy healthy app server (~1 ms).
3. The **app server** verifies the token and extracts the `userId` (~1–2 ms).
4. It asks **Redis** for `notes:user:7`.
   - **Hit** (~1 ms): return the cached list immediately. Total ≈ 5 ms.
   - **Miss** (~20 ms): continue to step 5.
5. On a miss, the app server runs the query against a **read replica** using
   `notes_user_created_idx` (`WHERE user_id = 7 ORDER BY created_at DESC
   LIMIT 10`).
6. It stores the result in **Redis** as `notes:user:7` with a 5-minute TTL
   and returns it. The next request for that user is a hit.
7. The load balancer streams the JSON back to the browser, which renders the
   notes.

With 80–90% of reads served from Redis, the database sees only a small
fraction of the 200 reads/s and stays comfortable.

## 6. Request flow — `POST /notes`

1. The browser submits the form; the client has already validated that the
   title exists and is ≤ 100 characters.
2. The **load balancer** forwards the request to any healthy app server.
3. The **app server** re-validates (never trust the client), derives `userId`
   from the token — never from the body — and writes one row to the
   **primary database** (~5–10 ms). Only the primary accepts writes.
4. It **invalidates the cache**: `DEL notes:user:7`, so the next read fetches
   fresh data instead of serving a list that is missing the new note.
5. It pushes the slow follow-up job onto the **queue**
   (`{ type: "reindex_tags", noteId }`) and does not wait for it.
6. It responds **201 Created** with the new note (including its `id` and
   timestamps).
7. Within a few milliseconds the primary **replicates** the new row to the
   read replica.
8. The **worker** picks the job off the queue and updates the tag search
   index in the background.

## 7. Trade-offs

### Trade-off 1 — Speed versus freshness (caching)

Caching note lists in Redis makes a repeat read ~1 ms instead of ~20 ms and
keeps the database free for writes. The cost is **staleness**: for the few
milliseconds between a write and the `DEL`, or for the life of the TTL if a
`DEL` is missed, a user could see a slightly old list. For a note app a
list that is one second out of date is harmless — unlike a bank balance —
so we take the speed.

### Trade-off 2 — Consistency versus availability (replication)

The primary + read replica design means a read can land on a replica that
has not yet received the newest note (replication lag). For a few
milliseconds after `POST /notes`, `GET /notes` may not show the new note.
We accept this **eventual consistency** because forcing every read onto the
primary would make the primary the bottleneck and collapse throughput at
peak. Availability wins here because feeds do not need to be perfectly
linearisable.

### Trade-off 3 — Simplicity versus scalability (monolith first)

At 1M users QuickNotes can still be a single well-organised monolith: auth,
notes, tags and search in one codebase. We resist splitting into
microservices because the read-heavy load is absorbed by the cache and CDN,
not by smarter code. The trade is a lower scaling ceiling in exchange for
much simpler debugging and deployment — the right call at this stage. When
search or PDF export starts to dominate, that one piece can be split out.

## 8. How single points of failure are avoided

| Potential SPOF | How it is removed |
|----------------|-------------------|
| One app server | Three identical **stateless** servers behind the load balancer; any two can carry the load while the third is replaced. |
| The load balancer | A managed, multi-node load balancer (ELB, Cloudflare) that is itself replicated and health-checked. |
| The cache | Redis failure is **graceful degradation**: the app falls back to the read replica, slower but still correct. |
| The primary database | A hot standby plus **read replicas**; if the primary fails, a replica is promoted (failover) and the app reconnects. |
| The queue | A managed, replicated queue (SQS) that stores messages durably until a worker confirms them. |
| The CDN | Many edge servers worldwide; a failed edge simply stops being used. |
| DNS | Multiple authoritative name servers / anycast DNS. |
| The whole region | Nightly backups plus the ability to restore into a second region. |

## 9. Summary

QuickNotes at one million users is a **read-heavy** system: about 40 reads/s
and 10 writes/s on average (200/50 at peak), producing roughly **365 GB of
notes per year**. The design serves the static front end from a CDN, absorbs
note-list reads in Redis, scales three stateless app servers horizontally
behind a load balancer, splits database reads onto a replica, and pushes
slow follow-up work to a queue and worker. Each decision trades a little
freshness or simplicity for a lot of throughput — which is the right trade
for a note-taking app.