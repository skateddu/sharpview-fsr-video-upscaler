import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FpsMeter, GpuBudget, PerfGovernor } from '../../src/content/perf.ts';

// At 60 fps the interval between frames is 16.7 ms: "heavy" above 8.3 ms.
const HEAVY = 12;
const LIGHT = 1;

test('PerfGovernor: steps in after 3 slow and heavy seconds', () => {
  const g = new PerfGovernor();
  assert.equal(g.sample(40, 60, HEAVY), false);
  assert.equal(g.sample(40, 60, HEAVY), false);
  assert.equal(g.sample(40, 60, HEAVY), true);
  // After stepping in, counting starts over.
  assert.equal(g.sample(40, 60, HEAVY), false);
});

test('PerfGovernor: low fps but light work (covered window) → no action', () => {
  const g = new PerfGovernor();
  for (let i = 0; i < 10; i++) assert.equal(g.sample(5, 60, LIGHT), false);
});

test('PerfGovernor: heavy work that keeps up with the video → no action', () => {
  const g = new PerfGovernor();
  for (let i = 0; i < 10; i++) assert.equal(g.sample(59, 60, HEAVY), false);
});

test('PerfGovernor: one good second resets the count', () => {
  const g = new PerfGovernor();
  g.sample(40, 60, HEAVY);
  g.sample(40, 60, HEAVY);
  assert.equal(g.sample(59, 60, HEAVY), false);
  assert.equal(g.sample(40, 60, HEAVY), false);
  assert.equal(g.sample(40, 60, HEAVY), false);
});

test('PerfGovernor: small gaps tolerated (rAF and video frames not aligned)', () => {
  const g = new PerfGovernor();
  for (let i = 0; i < 10; i++) assert.equal(g.sample(50, 60, HEAVY), false);
});

test('PerfGovernor: the cost threshold follows the video frame rate', () => {
  // At 24 fps the interval is 41.7 ms: 12 ms is not heavy.
  const g = new PerfGovernor();
  for (let i = 0; i < 5; i++) assert.equal(g.sample(15, 24, HEAVY), false);
  for (let i = 0; i < 2; i++) assert.equal(g.sample(15, 24, 30), false);
  assert.equal(g.sample(15, 24, 30), true);
});

test('PerfGovernor: paused or buffering video does not count', () => {
  const g = new PerfGovernor();
  g.sample(10, 60, HEAVY);
  g.sample(10, 60, HEAVY);
  assert.equal(g.sample(0, 0, HEAVY), false);
  assert.equal(g.sample(2, 5, HEAVY), false);
  assert.equal(g.sample(10, 60, HEAVY), false);
});

test('GpuBudget: limit, release and idempotent acquire', () => {
  const b = new GpuBudget(2);
  const [a, c, d] = [{}, {}, {}];
  assert.equal(b.acquire(a), true);
  assert.equal(b.acquire(a), true);
  assert.equal(b.acquire(c), true);
  assert.equal(b.acquire(d), false);
  assert.equal(b.used, 2);
  b.release(a);
  assert.equal(b.acquire(d), true);
});

test('GpuBudget: when full, tries to reclaim unused contexts', () => {
  const b = new GpuBudget(1);
  const [a, c] = [{}, {}];
  b.acquire(a);
  b.reclaim = () => b.release(a);
  assert.equal(b.acquire(c), true);
  assert.equal(b.used, 1);
  b.reclaim = () => {};
  assert.equal(b.acquire({}), false);
});

test('FpsMeter: the first call only sets the baseline', () => {
  const m = new FpsMeter();
  // The video counter is already at 5000: it must not become "5000 fps".
  assert.equal(m.frame(0, () => 5000), false);
  let closed = false;
  for (let i = 1; i <= 61; i++) closed = m.frame(i * (1000 / 60), () => 5000 + i) || closed;
  assert.equal(closed, true);
  assert.ok(Math.abs(m.fps - 60) < 1.5, String(m.fps));
  assert.ok(Math.abs(m.videoFps - 60) < 1.5, String(m.videoFps));
});

test('FpsMeter: reads the video counter only when a window opens or closes', () => {
  const m = new FpsMeter();
  let reads = 0;
  const counter = () => (reads++, 0);
  for (let i = 0; i <= 61; i++) m.frame(i * (1000 / 60), counter);
  assert.equal(reads, 2);
});

test('FpsMeter: reset after a new source', () => {
  const m = new FpsMeter();
  m.frame(0, () => 100);
  m.frame(1000, () => 130);
  assert.equal(Math.round(m.videoFps), 30);
  m.reset();
  assert.equal(m.fps, 0);
  // The new video's counter starts from 0: no negative values.
  assert.equal(m.frame(2000, () => 0), false);
  m.frame(3000, () => 24);
  assert.equal(Math.round(m.videoFps), 24);
});
