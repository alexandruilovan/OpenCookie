import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlickDetector } from '../src/renderer/gesture.js';

test('spawn grace and slow pointer movement do not give cookies', () => {
  const flick = new FlickDetector(); flick.reset(0,0,0);
  assert.equal(flick.move(300,0,50), false);
  for (let time = 100; time <= 2000; time += 50) assert.equal(flick.move(300+time/4,0,time), false);
});
test('a quick gesture gives once, observes the cooldown, and can give again later', () => {
  const flick = new FlickDetector(); flick.reset(0,0,0);
  flick.move(0,0,600);
  assert.equal(flick.move(250,0,660), true);
  assert.equal(flick.move(0,0,710), false);
  flick.move(0,0,2500);
  assert.equal(flick.move(250,0,2560), true);
});
