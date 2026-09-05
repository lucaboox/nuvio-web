import assert from 'node:assert/strict';
import test from 'node:test';
import { containsTime, nativeMediaSource, NativeMkvPlayer } from '../src/lib/nativeMkvPlayer.ts';

test('native remux only treats actually buffered ranges as seekable', () => {
  const ranges = { length: 2, start: i => [0, 20][i], end: i => [5, 25][i] };
  assert.equal(containsTime(ranges, 2), true);
  assert.equal(containsTime(ranges, 10), false);
  assert.equal(containsTime(ranges, 22), true);
  assert.equal(containsTime(ranges, 25), false);
});
test('no native remux without browser media source API', () => {
  assert.equal(nativeMediaSource(), undefined);
});
test('cancellation rejects pending native source work immediately', async () => {
  const p = new NativeMkvPlayer({}, 'https://example.test/file.mkv', () => {});
  const controller = new AbortController();
  const pending = p.bounded(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(pending, /canceled/);
});
test('SourceBuffer errors are surfaced and listeners removed', async () => {
  const p = new NativeMkvPlayer({}, 'https://example.test/file.mkv', () => {});
  const buffer = new EventTarget();
  await assert.rejects(p.update(buffer, () => queueMicrotask(() => buffer.dispatchEvent(new Event('error'))), new AbortController().signal), /rejected/);
});
