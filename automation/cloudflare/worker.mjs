// Cron-only Worker: no public URL and no access to the Tencent source secret.
const REPO_API = 'https://api.github.com/repos/CYRickyArAr/cube-training-stats/actions';
const API = `${REPO_API}/workflows/pages.yml`;
const STALE_QUEUED_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const READ_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [250,1000];
const RETRYABLE_STATUS = new Set([500,502,503,504]);

function queueAge(run,now) {
  const created = Date.parse(run.created_at);
  const updated = run.updated_at ? Date.parse(run.updated_at) : created;
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return null;
  const age = now-Math.max(created,updated);
  return age >= 0 ? age : null;
}
function runLabel(run) {
  if (Number.isSafeInteger(run.run_number)) return `#${run.run_number}`;
  return Number.isSafeInteger(run.id) ? `id=${run.id}` : 'unknown run';
}

export async function triggerUpdate(env, request = fetch, {
  now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve,ms)),
} = {}) {
  if (!env.GITHUB_TOKEN) throw new Error('Missing GITHUB_TOKEN secret');
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cube-training-scheduler',
  };
  const notes = [];
  let retries = 0;
  const result = text => [text,...notes,retries ? `GET retries=${retries}` : ''].filter(Boolean).join('; ');
  async function github(url,label,options = {}) {
    const read = !options.method || options.method === 'GET';
    const attempts = read ? READ_ATTEMPTS : 1;
    for (let attempt=1;attempt<=attempts;attempt++) {
      let response;
      try {
        response = await request(url,{...options,headers,signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
      } catch {
        // Never log headers, response bodies, credentials or upstream exception text.
        if (!read || attempt === attempts) throw new Error(`GitHub API network failure (${label}, attempt ${attempt}/${attempts}${read ? '' : '; dispatch outcome unknown, not retried'})`);
      }
      if (response?.ok) return response;
      if (response) {
        try { await response.body?.cancel(); } catch {}
        if (!read || !RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
          throw new Error(`GitHub API HTTP ${response.status} (${label}, attempt ${attempt}/${attempts}${!read && response.status >= 500 ? '; dispatch outcome unknown, not retried' : ''})`);
        }
      }
      retries++;
      await wait(RETRY_DELAYS_MS[attempt-1]);
    }
  }
  async function githubJson(url,label) {
    const response = await github(url,label);
    try { return await response.json(); }
    catch { throw new Error(`Invalid GitHub JSON (${label})`); }
  }
  // Normal queued/running work and approval waits remain blockers regardless of age.
  for (const status of ['queued','in_progress','waiting','pending','requested']) {
    const data = await githubJson(`${API}/runs?branch=main&status=${status}&per_page=1`,`${status} runs`);
    if (!Array.isArray(data.workflow_runs) || data.workflow_runs.length > 1) throw new Error(`Invalid GitHub run list (${status})`);
    const run = data.workflow_runs[0];
    if (!run) continue;
    const age = queueAge(run,now());
    if (status === 'queued' && run.status === 'queued' && run.head_branch === 'main' &&
        Number.isSafeInteger(run.id) && run.id > 0 && age !== null && age >= STALE_QUEUED_MS) {
      const jobs = await githubJson(`${REPO_API}/runs/${run.id}/jobs?filter=all&per_page=1`,'queued jobs');
      if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) || jobs.total_count < 0) throw new Error('Invalid GitHub job list (queued jobs)');
      if (jobs.total_count === 0 && jobs.jobs.length === 0) {
        notes.push(`ignored stale queued ${runLabel(run)}, age=${Math.floor(age/60000)}m, jobs=0`);
        continue;
      }
    }
    return result(`skipped: workflow already active (${status} ${runLabel(run)}${age === null ? '' : `, age=${Math.floor(age/60000)}m`})`);
  }
  // Dispatch is not idempotent: retry only reads; the next Cron checks state again.
  const response = await github(`${API}/dispatches`,'dispatch',{method:'POST',body:JSON.stringify({ref:'main'})});
  try { await response.body?.cancel(); } catch {}
  return result('dispatched');
}

export default {
  async scheduled(_event,env) {
    try { console.log(await triggerUpdate(env)); }
    catch (error) { console.error(`scheduler failed: ${error.message}`); throw error; }
  },
};
