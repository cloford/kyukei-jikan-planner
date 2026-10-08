import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBreaks, validateJobs } from '../dist/calculation.js';

let nextId = 1;
const toMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};
const job = (start, end, name = '') => ({ id: String(nextId++), name, start: toMinutes(start), end: toMinutes(end) });

function breaksOf(result) {
  return result.breaks ?? result.rests ?? [];
}

function summary(result) {
  return {
    breaks: breaksOf(result).map(({ start, end, duration }) => ({
      start: fromMinutes(start),
      end: fromMinutes(end),
      minutes: duration,
    })),
    totalMinutes: result.totalMinutes,
    count: result.count,
    feasible: result.status === 'valid',
  };
}

function fromMinutes(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function expectPlan(jobs, expected) {
  const result = calculateBreaks(jobs, 10);
  assert.deepEqual(summary(result), expected);
}

test('最短時間の初期値は30分で、10〜40分を5分刻みで変更できる', () => {
  const cases = [job('09:00', '10:00'), job('10:40', '11:00')];
  assert.equal(calculateBreaks(cases).totalMinutes, 30);
  assert.equal(calculateBreaks(cases, 35).totalMinutes, 0);
  assert.equal(calculateBreaks(cases, 10).totalMinutes, 30);
  for (const value of [5, 12, 45]) assert.throws(() => calculateBreaks(cases, value), RangeError);
});

test('基本例では候補区間を両方使い、合計160分になる', () => {
  expectPlan(
    [job('09:00', '10:00'), job('11:00', '12:00'), job('14:00', '15:00')],
    {
      breaks: [
        { start: '10:05', end: '10:55', minutes: 50 },
        { start: '12:05', end: '13:55', minutes: 110 },
      ],
      totalMinutes: 160,
      count: 2,
      feasible: true,
    },
  );
});

test('案件は開始時刻順に扱う', () => {
  expectPlan(
    [job('14:00', '15:00'), job('09:00', '10:00'), job('11:00', '12:00')],
    {
      breaks: [
        { start: '10:05', end: '10:55', minutes: 50 },
        { start: '12:05', end: '13:55', minutes: 110 },
      ],
      totalMinutes: 160,
      count: 2,
      feasible: true,
    },
  );
});

test('生のスキマが20分なら10分休憩を取れる', () => {
  expectPlan([job('09:00', '10:00'), job('10:20', '11:00')], {
    breaks: [{ start: '10:05', end: '10:15', minutes: 10 }],
    totalMinutes: 10,
    count: 1,
    feasible: true,
  });
});

test('生のスキマが15分なら候補にならず、短い日は休憩0回で成立する', () => {
  expectPlan([job('09:00', '10:00'), job('10:15', '11:00')], {
    breaks: [],
    totalMinutes: 0,
    count: 0,
    feasible: true,
  });
});

test('5時間未満の単独案件は休憩0回で成立する', () => {
  expectPlan([job('09:00', '12:00')], {
    breaks: [],
    totalMinutes: 0,
    count: 0,
    feasible: true,
  });
});

test('最初の休憩開始が開始から5時間を超える日は成立しない', () => {
  expectPlan([job('09:00', '14:00'), job('14:20', '17:00')], {
    breaks: [],
    totalMinutes: 0,
    count: 0,
    feasible: false,
  });
});

test('最後の休憩後から最終案件終了まで5時間を超えても成立する', () => {
  expectPlan(
    [job('09:00', '10:00'), job('10:20', '11:00'), job('11:30', '18:00')],
    {
      breaks: [
        { start: '10:05', end: '10:15', minutes: 10 },
        { start: '11:05', end: '11:25', minutes: 20 },
      ],
      totalMinutes: 30,
      count: 2,
      feasible: true,
    },
  );
});

test('同じスキマを分割せず、合計時間が同じなら休憩回数の少ない案を選ぶ', () => {
  expectPlan([job('09:00', '10:00'), job('10:40', '11:00')], {
    breaks: [{ start: '10:05', end: '10:35', minutes: 30 }],
    totalMinutes: 30,
    count: 1,
    feasible: true,
  });
});

test('案件の終了と次案件の開始が同時刻なら重複ではない', () => {
  const jobs = [job('09:00', '10:00'), job('10:00', '11:00')];
  assert.equal(validateJobs(jobs).valid, true);
});

test('案件が重なると入力エラーになる', () => {
  const jobs = [job('09:00', '10:30'), job('10:00', '11:00')];
  assert.equal(validateJobs(jobs).valid, false);
});

test('終了時刻が開始時刻以下なら入力エラーになる', () => {
  for (const invalid of [job('09:00', '09:00'), job('10:00', '09:00')]) {
    assert.equal(validateJobs([invalid]).valid, false);
  }
});

test('時刻が5分刻みでない、または24時間表記でない場合は入力エラーになる', () => {
  assert.equal(validateJobs([job('09:00', '10:00')]).valid, true);
  for (const invalid of [
    { id: 'off-grid', name: '', start: 9 * 60 + 1, end: 10 * 60 },
    { id: 'out-of-range', name: '', start: 1500, end: 1560 },
  ]) assert.equal(validateJobs([invalid]).valid, false);
  assert.equal(validateJobs([{ id: 'day-end', name: '', start: 23 * 60, end: 1440 }]).valid, true);
});

