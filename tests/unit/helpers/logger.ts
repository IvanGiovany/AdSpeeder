import { vi, type Mock } from 'vitest';

type LogFn = Mock<(...args: unknown[]) => void>;

/** A Logger whose methods are mocks, so tests can assert on what was logged. */
export function silentLogger(): { debug: LogFn; info: LogFn; warn: LogFn; error: LogFn } {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
