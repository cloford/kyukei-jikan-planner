import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAllocatedBreaks } from '../dist/calculation.js';

const minute = (time) => {
  const [hour, part] = time.split(':').map(Number);
  return hour * 60 + part;
};
const jobs = (...ranges) => ranges.map(([start, end], index) => ({ id: String(index + 1), start: minute(start), end: minute(end) }));
const shown = (result) => result.breaks.map((item) => [item.start, item.end, item.duration]);

test('案件がない日は拘束時間を算出しない', () => {
  const result = calculateAllocatedBreaks([]);
  assert.equal(result.status, 'empty');
  assert.equal(result.confinementMinutes, null);
  assert.equal(result.actualMinutes, null);
});

test('5時間未満の日は0回で成立する', () => {
  const result = calculateAllocatedBreaks(jobs(['09:00', '12:00']));
  assert.equal(result.status, 'valid');
  assert.equal(result.actualMinutes, 0);
  assert.equal(result.count, 0);
});

test('拘束7時間で実際0分なら5時間条件により成立しない', () => {
  const result = calculateAllocatedBreaks(jobs(['09:00', '16:00']));
  assert.equal(result.actualMinutes, 0);
  assert.equal(result.status, 'impossible');
});

test('拘束8時間5分で実際5分なら最短10分を満たせない', () => {
  const result = calculateAllocatedBreaks(jobs(['09:00', '17:00']));
  assert.equal(result.actualMinutes, 5);
  assert.equal(result.status, 'impossible');
});

test('09:00開始・18:00終了の拘束時間は9時間5分', () => {
  const result = calculateAllocatedBreaks(jobs(['09:00', '18:00']));
  assert.equal(result.confinementMinutes, 545);
  assert.equal(result.actualMinutes, 65);
});

test('最短時間の初期値30分では成立せず、10分なら成立する', () => {
  const ranges = jobs(['09:00', '10:00'], ['10:20', '14:25'], ['16:35', '18:00']);
  assert.equal(calculateAllocatedBreaks(ranges).status, 'impossible');
  const ten = calculateAllocatedBreaks(ranges, 10);
  assert.equal(ten.status, 'valid');
  assert.equal(ten.breaks[0].duration, 10);
  assert.equal(ten.totalMinutes, ten.actualMinutes);
});

test('30分と40分では早い休憩の配分が変わる', () => {
  const ranges = jobs(['09:00', '10:00'], ['11:00', '12:00'], ['14:00', '19:00']);
  assert.equal(calculateAllocatedBreaks(ranges, 30).breaks[0].duration, 30);
  assert.equal(calculateAllocatedBreaks(ranges, 40).breaks[0].duration, 40);
});

test('実際65分を後ろの候補にまとめ、開始をできるだけ遅くする', () => {
  const result = calculateAllocatedBreaks(jobs(['09:00', '10:00'], ['11:00', '12:00'], ['14:00', '18:00']));
  assert.equal(result.status, 'valid');
  assert.equal(result.actualMinutes, 65);
  assert.equal(result.maxAvailableMinutes, 160);
  assert.deepEqual(shown(result), [[minute('12:50'), minute('13:55'), 65]]);
});

test('後ろの候補が足りない分だけ早い候補から取る', () => {
  const result = calculateAllocatedBreaks(jobs(['09:00', '10:00'], ['11:00', '12:00'], ['14:00', '19:00']), 10);
  assert.equal(result.actualMinutes, 125);
  assert.equal(result.status, 'valid');
  assert.deepEqual(shown(result), [
    [minute('10:40'), minute('10:55'), 15],
    [minute('12:05'), minute('13:55'), 110],
  ]);
});

test('後ろの候補だけでは初回5時間条件に届かず、早い10分を確保する', () => {
  const result = calculateAllocatedBreaks(jobs(['09:00', '10:00'], ['10:20', '14:25'], ['16:35', '18:00']), 10);
  assert.equal(result.actualMinutes, 65);
  assert.equal(result.status, 'valid');
  assert.deepEqual(shown(result), [
    [minute('10:05'), minute('10:15'), 10],
    [minute('15:15'), minute('16:10'), 55],
  ]);
});

test('休憩案は3回以内で実際の休憩時間に正確に一致する', () => {
  const result = calculateAllocatedBreaks(jobs(['09:00', '10:00'], ['11:00', '12:00'], ['13:00', '14:00'], ['15:00', '16:00'], ['17:00', '19:55']));
  assert.equal(result.actualMinutes, 180);
  assert.equal(result.status, 'impossible');
});

test('重複は計算不能ではなく入力エラーにする', () => {
  const result = calculateAllocatedBreaks(jobs(['09:00', '10:30'], ['10:00', '11:00']));
  assert.equal(result.status, 'invalid');
});
