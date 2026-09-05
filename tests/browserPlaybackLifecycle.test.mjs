import assert from 'node:assert/strict';
import test from 'node:test';
import { MediabunnyPlayer } from '../src/lib/mediabunnyPlayer.ts';

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const player = () => new MediabunnyPlayer('https://example.test/file.mkv', {}, () => {});

test('silent video has an advancing wall clock rather than waiting forever for audio', () => {
  const p = player();
  p.playing = true;
  p.startedFrom = 10;
  p.contextStartTime = performance.now() / 1000 - 2;
  assert.ok(p.currentTime >= 12);
  p.pause();
  const paused = p.currentTime;
  assert.equal(p.currentTime, paused);
});

test('stopped startup cannot continue into another stage', async () => {
  const p = player();
  const pending = deferred();
  const stage = p.stage('Testing', () => pending.promise);
  p.stop();
  pending.resolve('late');
  await assert.rejects(stage, /canceled/);
  let ran = false;
  await assert.rejects(p.stage('Next', async () => { ran = true; }), /canceled/);
  assert.equal(ran, false);
});

test('startup timeout disposes input resources', async () => {
  const p = player();
  let disposed = false;
  p.input = { dispose() { disposed = true; } };
  await assert.rejects(p.stage('Testing', () => new Promise(() => {}), 1), /Gave up/);
  assert.equal(disposed, true);
});

test('late audio resume cannot revive stopped playback', async () => {
  const p = player();
  const pending = deferred();
  p.context = { state: 'suspended', resume: () => pending.promise, close: async () => {} };
  let started = false;
  p.run = () => { started = true; };
  const play = p.play();
  p.stop();
  p.context.state = 'running';
  pending.resolve();
  await play;
  assert.equal(started, false);
  assert.equal(p.paused, true);
});

test('old seek frame cannot paint over a newer seek', async () => {
  const p = player();
  const pending = deferred();
  const drawn = [];
  p.videoSink = { getCanvas: time => time === 1 ? pending.promise : Promise.resolve({ timestamp: time }) };
  p.draw = frame => drawn.push(frame.timestamp);
  const old = p.seek(1);
  await p.seek(2);
  pending.resolve({ timestamp: 1 });
  await old;
  assert.deepEqual(drawn, [2]);
});

test('missing decoded frame is an error, not a ready black screen', async () => {
  const p = player();
  p.videoSink = { getCanvas: async () => null };
  await assert.rejects(p.seek(0), /No video frame/);
});
