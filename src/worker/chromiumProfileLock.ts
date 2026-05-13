import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const chromiumSingletonFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"] as const;

export async function clearStaleChromiumProfileLocks(profileDir: string): Promise<string[]> {
  if (!(await hasChromiumSingletonFiles(profileDir))) {
    return [];
  }
  if (await chromiumSingletonLooksActive(profileDir)) {
    return [];
  }

  const removed: string[] = [];
  for (const fileName of chromiumSingletonFiles) {
    const filePath = path.join(profileDir, fileName);
    try {
      await fs.rm(filePath, { force: true });
      removed.push(fileName);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return removed;
}

async function hasChromiumSingletonFiles(profileDir: string): Promise<boolean> {
  for (const fileName of chromiumSingletonFiles) {
    try {
      await fs.lstat(path.join(profileDir, fileName));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return false;
}

async function chromiumSingletonLooksActive(profileDir: string): Promise<boolean> {
  const lockTarget = await readSymlinkTarget(path.join(profileDir, "SingletonLock"));
  const lockMatch = lockTarget?.match(/^(.+)-(\d+)$/);
  if (lockMatch && lockMatch[1] === os.hostname() && processExists(Number(lockMatch[2]))) {
    return true;
  }

  const socketPath = path.join(profileDir, "SingletonSocket");
  const socketTarget = await readSymlinkTarget(socketPath);
  if (!socketTarget) {
    return false;
  }
  const resolvedSocket = path.isAbsolute(socketTarget) ? socketTarget : path.resolve(path.dirname(socketPath), socketTarget);
  try {
    return (await fs.stat(resolvedSocket)).isSocket();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readSymlinkTarget(filePath: string): Promise<string | null> {
  try {
    return await fs.readlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EINVAL") {
      return null;
    }
    throw error;
  }
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
