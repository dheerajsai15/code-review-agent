import "dotenv/config";
import { Octokit } from "@octokit/rest";

const o = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = "dheerajsai15";
const repo = "pr-review-agent-sandbox";
const pull_number = 1;

const { data } = await o.pulls.listReviews({ owner, repo, pull_number });
console.log("reviews on PR:", data.length);
for (const r of data) {
  console.log(`- by ${r.user?.login} [${r.state}] @ ${r.submitted_at}`);
  console.log("  body starts:", JSON.stringify((r.body || "").slice(0, 70)));
}
