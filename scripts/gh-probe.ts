import "dotenv/config";
import { Octokit } from "@octokit/rest";

const o = new Octokit({ auth: process.env.GITHUB_TOKEN });

const me = await o.users.getAuthenticated();
console.log("authenticated as:", me.data.login);

const repos = await o.paginate(o.repos.listForAuthenticatedUser, { per_page: 100 });
console.log(`accessible repos: ${repos.length}`);
for (const r of repos) {
  const p = r.permissions ?? {};
  console.log(`  ${r.full_name}  push=${!!p.push}  admin=${!!p.admin}  default=${r.default_branch}`);
}

console.log("openai key set:", !!process.env.OPENAI_API_KEY, "| USE_LLM:", process.env.USE_LLM);
