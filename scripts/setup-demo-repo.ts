import "dotenv/config";
import { Octokit } from "@octokit/rest";

const o = new Octokit({ auth: process.env.GITHUB_TOKEN });
const me = await o.users.getAuthenticated();
const owner = me.data.login;

// --- file contents -----------------------------------------------------------

// Baseline (main): a small, reasonable HTTP user service.
const baseline: Record<string, string> = {
  "README.md": `# user-service

A small HTTP user service (demo repo for the PR review agent).

\`\`\`
src/
  server.ts   routes.ts   auth.ts   users.ts   db.ts   config.ts
  utils/      logger.ts   validate.ts
\`\`\`
`,
  "package.json": `{
  "name": "user-service",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsc", "start": "node dist/server.js" },
  "dependencies": {
    "express": "^4.19.0",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.12.0"
  }
}
`,
  "src/config.ts": `export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost/users",
};
`,
  "src/db.ts": `import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
`,
  "src/utils/logger.ts": `export const logger = {
  info: (...a: unknown[]) => console.log("[info]", ...a),
  error: (...a: unknown[]) => console.error("[error]", ...a),
};
`,
  "src/utils/validate.ts": `export function isEmail(value: string): boolean {
  return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(value);
}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
`,
  "src/auth.ts": `import jwt from "jsonwebtoken";
import { config } from "./config.js";

export interface Claims {
  userId: string;
  role: string;
}

export function verifyToken(token: string): Claims {
  return jwt.verify(token, config.jwtSecret) as Claims;
}

export function requireRole(claims: Claims, role: string): void {
  if (claims.role !== role) {
    throw new Error("forbidden");
  }
}
`,
  "src/users.ts": `import { query } from "./db.js";

export interface User {
  id: string;
  email: string;
  name: string;
}

export async function getUser(id: string): Promise<User | undefined> {
  const rows = await query<User>("SELECT id, email, name FROM users WHERE id = $1", [id]);
  return rows[0];
}

export async function listUsers(): Promise<User[]> {
  return query<User>("SELECT id, email, name FROM users ORDER BY name", []);
}
`,
  "src/routes.ts": `import { Router } from "express";
import { getUser, listUsers } from "./users.js";

export const router = Router();

router.get("/users", async (_req, res) => {
  const users = await listUsers();
  res.json(users);
});

router.get("/users/:id", async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "not found" });
  res.json(user);
});
`,
  "src/server.ts": `import express from "express";
import { router } from "./routes.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

const app = express();
app.use(express.json());
app.use("/api", router);

app.listen(config.port, () => logger.info("listening on " + config.port));
`,
};

// PR branch (feature/payments): new payments module + edits that plant issues.
const prChanges: Record<string, string> = {
  // NEW: payments module — SQL injection, sensitive logging, float money,
  // fire-and-forget external call, swallowed errors, `any`, loose equality.
  "src/payments.ts": `import { query } from "./db.js";
import { logger } from "./utils/logger.js";

export async function chargeUser(userId: string, amountDollars: number, cardToken: string) {
  logger.info("charging", userId, cardToken);

  const cents = amountDollars * 100;

  const rows = await query(
    "INSERT INTO payments (user_id, amount_cents) VALUES ('" + userId + "', " + cents + ") RETURNING id"
  );

  fetch("https://api.payments.example.com/charge", {
    method: "POST",
    body: JSON.stringify({ cardToken, cents }),
  });

  return rows[0];
}

export async function refund(paymentId: string) {
  const payment: any = (await query("SELECT * FROM payments WHERE id = " + paymentId))[0];
  if (payment.refunded == false) {
    await query("UPDATE payments SET refunded = true WHERE id = " + paymentId);
  }
  return payment;
}
`,
  // MODIFIED: weaker auth — hardcoded secret fallback, ignored expiry,
  // token logging, loose equality, admin bypass.
  "src/auth.ts": `import jwt from "jsonwebtoken";
import { config } from "./config.js";

export interface Claims {
  userId: string;
  role: string;
}

export function verifyToken(token: string): Claims {
  const secret = config.jwtSecret || "dev-secret";
  const decoded = jwt.verify(token, secret, { ignoreExpiration: true }) as Claims;
  console.log("verified token for", decoded.userId);
  return decoded;
}

export function requireRole(claims: Claims, role: string): void {
  if (claims.role == "admin" || claims.role == role) {
    return;
  }
  throw new Error("forbidden");
}
`,
  // MODIFIED: N+1 queries, `any`, fire-and-forget insert, no validation.
  "src/users.ts": `import { query } from "./db.js";

export interface User {
  id: string;
  email: string;
  name: string;
}

export async function getUser(id: string): Promise<User | undefined> {
  const rows = await query<User>("SELECT id, email, name FROM users WHERE id = $1", [id]);
  return rows[0];
}

export async function listUsers(): Promise<User[]> {
  return query<User>("SELECT id, email, name FROM users ORDER BY name", []);
}

export async function getUsersWithOrders(ids: string[]): Promise<any[]> {
  const result: any[] = [];
  for (const id of ids) {
    const user = await getUser(id);
    const orders = await query("SELECT * FROM orders WHERE user_id = $1", [id]);
    result.push({ ...user, orders });
  }
  return result;
}

export async function createUser(email: string, name: string) {
  query("INSERT INTO users (email, name) VALUES ($1, $2)", [email, name]);
  return { email, name };
}
`,
  // MODIFIED: new endpoints with no validation/auth, client-supplied amount.
  "src/routes.ts": `import { Router } from "express";
import { getUser, listUsers, createUser } from "./users.js";
import { chargeUser } from "./payments.js";

export const router = Router();

router.get("/users", async (_req, res) => {
  const users = await listUsers();
  res.json(users);
});

router.get("/users/:id", async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "not found" });
  res.json(user);
});

router.post("/users", async (req, res) => {
  const created = await createUser(req.body.email, req.body.name);
  res.json(created);
});

router.post("/charge", async (req, res) => {
  const result = await chargeUser(req.body.userId, req.body.amount, req.body.cardToken);
  res.json(result);
});
`,
  // NEW: a migration (reviewable text).
  "migrations/001_payments.sql": `CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  refunded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
  // NEW: a lockfile — triage should SKIP this one.
  "package-lock.json": `{
  "name": "user-service",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {}
}
`,
};

// --- helpers -----------------------------------------------------------------

type TreeEntry = { path: string; mode: "100644"; type: "blob"; content: string };
const toTree = (m: Record<string, string>): TreeEntry[] =>
  Object.entries(m).map(([path, content]) => ({ path, mode: "100644", type: "blob", content }));

async function commitFiles(
  repo: string,
  parentCommit: string,
  baseTree: string,
  files: Record<string, string>,
  message: string,
) {
  const tree = await o.git.createTree({ owner, repo, base_tree: baseTree, tree: toTree(files) });
  const commit = await o.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.data.sha,
    parents: [parentCommit],
  });
  return { commitSha: commit.data.sha, treeSha: tree.data.sha };
}

// --- build the repo ----------------------------------------------------------

let repo = "user-service-demo";
try {
  await o.repos.createForAuthenticatedUser({
    name: repo,
    private: true,
    auto_init: true,
    description: "Demo service to exercise the PR review agent.",
  });
} catch (e: any) {
  if (e.status === 422) {
    repo = `user-service-demo-${Date.now()}`;
    await o.repos.createForAuthenticatedUser({ name: repo, private: true, auto_init: true });
  } else throw e;
}
console.log(`repo: ${owner}/${repo}`);
await new Promise((r) => setTimeout(r, 1500)); // let auto_init settle

// 1. Seed the baseline onto main.
const mainRef = await o.git.getRef({ owner, repo, ref: "heads/main" });
const initialCommit = mainRef.data.object.sha;
const initial = await o.git.getCommit({ owner, repo, commit_sha: initialCommit });

const base = await commitFiles(repo, initialCommit, initial.data.tree.sha, baseline, "Initial user-service");
await o.git.updateRef({ owner, repo, ref: "heads/main", sha: base.commitSha });
console.log("baseline pushed to main");

// 2. Branch + commit the PR changes.
const branch = "feature/payments";
await o.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: base.commitSha });
const pr = await commitFiles(repo, base.commitSha, base.treeSha, prChanges, "Add payments feature");
await o.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: pr.commitSha });
console.log(`feature branch pushed: ${branch}`);

// 3. Open the PR.
const created = await o.pulls.create({
  owner,
  repo,
  title: "Add payments feature",
  head: branch,
  base: "main",
  body: [
    "Adds a payments module and wires up charge/refund + user creation endpoints.",
    "",
    "- `src/payments.ts` (new): charge + refund",
    "- `src/auth.ts`: token handling tweaks",
    "- `src/users.ts`: batch fetch + create",
    "- `src/routes.ts`: new endpoints",
    "- `migrations/001_payments.sql`, lockfile bump",
  ].join("\n"),
});

console.log(`\nPR ready: ${created.data.html_url}`);
console.log(`changed files: ${created.data.changed_files ?? "(see PR)"}`);
