// Cron-only Worker: no public URL and no access to the Tencent source secret.
const API = 'https://api.github.com/repos/CYRickyArAr/cube-training-stats/actions/workflows/pages.yml';

export async function triggerUpdate(env, request = fetch) {
  if (!env.GITHUB_TOKEN) throw new Error('Missing GITHUB_TOKEN secret');
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cube-training-scheduler',
  };
  async function github(url, options = {}) {
    const response = await request(url, {...options, headers, signal: AbortSignal.timeout(15000)});
    // Never log request headers, response bodies or credentials.
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    return response;
  }
  // Avoid adding more work while an earlier read/deployment is still pending.
  for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
    const response = await github(`${API}/runs?branch=main&status=${status}&per_page=1`);
    const data = await response.json();
    if (!Array.isArray(data.workflow_runs)) throw new Error('Invalid GitHub run list');
    if (data.workflow_runs.length) return 'skipped: workflow already active';
  }
  await github(`${API}/dispatches`, {method:'POST', body:JSON.stringify({ref:'main'})});
  return 'dispatched';
}

export default {
  async scheduled(_event, env) {
    console.log(await triggerUpdate(env));
  },
};
