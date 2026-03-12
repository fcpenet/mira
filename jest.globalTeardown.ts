import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(__dirname, '.integration-state.json');

export default async function globalTeardown() {
  if (!fs.existsSync(STATE_FILE)) {
    console.warn('[teardown] state file not found — skipping container cleanup');
    return;
  }

  const { pgContainerId, redisContainerId } = JSON.parse(
    fs.readFileSync(STATE_FILE, 'utf8')
  ) as { pgContainerId: string; redisContainerId: string };

  for (const id of [pgContainerId, redisContainerId]) {
    try {
      execSync(`docker stop ${id} && docker rm ${id}`, { stdio: 'pipe' });
    } catch {
      // Container may have already been removed — not fatal
    }
  }

  fs.unlinkSync(STATE_FILE);
  console.log('[teardown] containers stopped\n');
}
