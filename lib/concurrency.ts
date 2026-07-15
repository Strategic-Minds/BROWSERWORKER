const MAX_CONCURRENT = parseInt(process.env.BROWSER_MAX_CONCURRENT_JOBS || '2', 10);
let activeJobs = 0;

export function acquireSlot(): boolean {
  if (activeJobs >= MAX_CONCURRENT) return false;
  activeJobs++;
  return true;
}

export function releaseSlot(): void {
  if (activeJobs > 0) activeJobs--;
}

export function getActiveJobs(): number {
  return activeJobs;
}
