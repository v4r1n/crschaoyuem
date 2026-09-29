'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bootstrappedHarness, expectAppError } = require('./test-helpers.cjs');

test('equipment image validation accepts GIF signatures and rejects MIME spoofing', () => {
  const harness = bootstrappedHarness();
  const gif = [...Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64')];
  assert.equal(harness.invoke('assertImageSignature_', gif, 'image/gif'), undefined);
  const gif87a = [...gif];
  gif87a[4] = '7'.charCodeAt(0);
  assert.equal(harness.invoke('assertImageSignature_', gif87a, 'image/gif'), undefined);
  expectAppError(() => harness.invoke('assertImageSignature_', gif, 'image/png'), 'VALIDATION_FAILED');
  expectAppError(() => harness.invoke('assertImageSignature_', [...Buffer.from('GIF88a')], 'image/gif'),
    'VALIDATION_FAILED');
});
