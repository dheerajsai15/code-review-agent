import "dotenv/config";
import { Octokit } from "@octokit/rest";

const o = new Octokit({ auth: process.env.GITHUB_TOKEN });
const REPO = "pr-review-agent-sandbox";

const me = await o.users.getAuthenticated();
const owner = me.data.login;

// 1. Create the sandbox repo (private, with an initial commit). Reuse if it exists.
try {
  await o.repos.createForAuthenticatedUser({
    name: REPO,
    private: true,
    auto_init: true,
    description: "Throwaway repo to verify the PR review agent. Safe to delete.",
  });
  console.log(`created repo ${owner}/${REPO}`);
  await new Promise((r) => setTimeout(r, 1500)); // let auto_init settle
} catch (e: any) {
  if (e.status === 422) console.log(`repo ${owner}/${REPO} already exists — reusing`);
  else throw e;
}

const { data: repo } = await o.repos.get({ owner, repo: REPO });
const base = repo.default_branch;

// 2. Branch off the default branch.
const { data: ref } = await o.git.getRef({ owner, repo: REPO, ref: `heads/${base}` });
const branch = `agent-test-${Date.now()}`;
await o.git.createRef({ owner, repo: REPO, ref: `refs/heads/${branch}`, sha: ref.object.sha });

// 3. Add a file with several REAL issues for the reviewer to find.
const file = "src/payment.ts";
const content = `export function applyDiscount(price: number, code: string) {
  let final = price;
  if (code == "SAVE10") {                 // loose equality
    final = price - price * 0.1;
  }
  console.log("applying code", code);     // leftover debug log
  return final;
}

export function getUser(db: any, id) {    // 'any' + untyped param
  const query = "SELECT * FROM users WHERE id = " + id; // SQL injection
  return db.exec(query);
}

export async function charge(amount: number) {
  // fire-and-forget: missing await, result/errors ignored
  fetch("https://api.example.com/charge", {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
  return true;                            // reports success without checking
}
`;

await o.repos.createOrUpdateFileContents({
  owner,
  repo: REPO,
  path: file,
  message: "Add payment helpers",
  content: Buffer.from(content).toString("base64"),
  branch,
});

// 4. Open the PR.
const { data: pr } = await o.pulls.create({
  owner,
  repo: REPO,
  title: "Add payment helpers",
  head: branch,
  base,
  body: "Test PR for the review agent.",
});

console.log(`\nPR ready: ${pr.html_url}`);
console.log(`number: ${pr.number}  head sha: ${pr.head.sha}`);
