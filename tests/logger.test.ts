import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { logger } from '../src/utils/logger.js';

describe('Logger', () => {
  beforeEach(() => {
    // Reset console spies
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should log info messages', () => {
    logger.setLevel('info');
    logger.info('Test message');

    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[INFO] Test message')
    );
  });

  it('should not log debug when level is info', () => {
    logger.setLevel('info');
    logger.debug('Test debug');

    expect(console.debug).not.toHaveBeenCalled();
  });

  it('should log debug when level is debug', () => {
    logger.setLevel('debug');
    logger.debug('Test debug');

    expect(console.debug).toHaveBeenCalled();
  });

  it('should log warnings', () => {
    logger.setLevel('warn');
    logger.warn('Test warning');

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[WARN] Test warning')
    );
  });

  it('should log errors', () => {
    logger.setLevel('error');
    logger.error('Test error');

    expect(console.error).toHaveBeenCalled();
  });

  it('should format progress messages', () => {
    logger.setLevel('info');
    logger.progress(5, 10, 'Processing');

    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[5/10] (50%) Processing')
    );
  });
});
