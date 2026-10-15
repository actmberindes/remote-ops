import fs from 'node:fs';

const RETRY_DELAYS_MS = [250, 750, 1500];
const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Delete an expired monitoring file. Windows can temporarily lock files while
 * another process is reading them, so retry transient permission/busy errors
 * without blocking the request or retention sweep.
 */
export function deleteMonitoringFile(filePath, context = 'monitoring retention') {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    if (!RETRYABLE_CODES.has(error?.code)) {
      console.warn(`Unable to delete ${context} file ${filePath}: ${error.message}`);
      return false;
    }

    retryDelete(filePath, context, 0);
    return false;
  }
}

function retryDelete(filePath, context, retryIndex) {
  if (retryIndex >= RETRY_DELAYS_MS.length) {
    console.warn(`Unable to delete ${context} file after retries ${filePath}`);
    return;
  }

  setTimeout(async () => {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      if (RETRYABLE_CODES.has(error?.code)) {
        retryDelete(filePath, context, retryIndex + 1);
        return;
      }
      console.warn(`Unable to delete ${context} file ${filePath}: ${error.message}`);
    }
  }, RETRY_DELAYS_MS[retryIndex]).unref?.();
}
