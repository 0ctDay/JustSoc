import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ClaudeTaskSnapshot } from "./types.js";

export class TaskStore {
  constructor(private readonly dir: string) {}

  async init() {
    await mkdir(this.dir, { recursive: true });
  }

  async loadAll(): Promise<ClaudeTaskSnapshot[]> {
    await this.init();
    const entries = await readdir(this.dir, { withFileTypes: true });
    const tasks: ClaudeTaskSnapshot[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await readFile(path.join(this.dir, entry.name), "utf8");
        const parsed = JSON.parse(raw) as ClaudeTaskSnapshot;
        tasks.push(parsed);
      } catch {
        // Ignore malformed task files so one bad snapshot does not break startup.
      }
    }

    return tasks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async save(task: ClaudeTaskSnapshot) {
    await this.init();
    const destination = path.join(this.dir, `${task.id}.json`);
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, JSON.stringify(task, null, 2), "utf8");
    await rename(temporary, destination);
  }

  async remove(taskId: string) {
    await this.init();
    const destination = path.join(this.dir, `${taskId}.json`);
    try {
      await unlink(destination);
    } catch {
      // Ignore missing files so delete stays idempotent.
    }
  }
}
