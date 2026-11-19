import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The callback worker is driven explicitly by the tests (CallbackWorker.runOnce), never by a timer.
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/env.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    env: { CALLBACK_WORKER: 'off' },
  },
});
