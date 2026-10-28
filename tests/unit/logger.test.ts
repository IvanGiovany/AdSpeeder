import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/shared/logger';

function fakeSink() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('createLogger', () => {
  it('prefixes every line with [AdSpeeder:<scope>]', () => {
    const sink = fakeSink();
    const log = createLogger('youtube', { sink, isDebug: () => true });
    log.debug('a', 1);
    log.error('b');
    expect(sink.debug).toHaveBeenCalledWith('[AdSpeeder:youtube]', 'a', 1);
    expect(sink.error).toHaveBeenCalledWith('[AdSpeeder:youtube]', 'b');
  });

  it('gates debug and info on isDebug(), read on every call', () => {
    const sink = fakeSink();
    let debug = false;
    const log = createLogger('netflix', { sink, isDebug: () => debug });
    log.debug('hidden');
    log.info('hidden');
    debug = true;
    log.debug('shown');
    log.info('shown');
    expect(sink.debug).toHaveBeenCalledTimes(1);
    expect(sink.info).toHaveBeenCalledTimes(1);
  });

  it('always prints warn and error', () => {
    const sink = fakeSink();
    const log = createLogger('core', { sink });
    log.warn('w');
    log.error('e');
    expect(sink.warn).toHaveBeenCalledOnce();
    expect(sink.error).toHaveBeenCalledOnce();
  });
});
