/**
 * Validate one day's jobs.  Time values are minutes after 00:00.
 *
 * @param {Array<{id: string|number, name?: string, start: number, end: number}>} jobs
 * @returns {{valid: boolean, errors: Array<{id: string|number|undefined, field: string, message: string}>}}
 */
export function validateJobs(jobs) {
  const errors = [];

  if (!Array.isArray(jobs)) {
    return {
      valid: false,
      errors: [{ id: undefined, field: 'jobs', message: '案件の一覧が正しくありません。' }],
    };
  }

  const sorted = jobs.map((job, index) => ({ job, _inputIndex: index }));
  sorted.forEach((job, index) => {
    const source = job.job;
    const base = { id: source && source.id };
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      errors.push({ ...base, field: 'job', message: '案件の内容が正しくありません。' });
      return;
    }
    for (const field of ['start', 'end']) {
      const value = source[field];
      if (!Number.isInteger(value) || value < 0 || value > 1440) {
        errors.push({ ...base, field, message: '時刻は 00:00 から 24:00 までの分数で指定してください。' });
      } else if (value % 5 !== 0) {
        errors.push({ ...base, field, message: '時刻は5分刻みで指定してください。' });
      }
    }
    if (Number.isInteger(source.start) && Number.isInteger(source.end) && source.start >= source.end) {
      errors.push({ ...base, field: 'end', message: '終了時刻は開始時刻より後にしてください。' });
    }
  });

  if (errors.length) return { valid: false, errors };

  sorted.sort((a, b) => a.job.start - b.job.start || a.job.end - b.job.end || a._inputIndex - b._inputIndex);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1].job;
    const current = sorted[i].job;
    if (current.start < previous.end) {
      errors.push({
        id: current.id,
        field: 'start',
        message: 'ほかの案件と時間が重なっています。',
      });
      errors.push({
        id: previous.id,
        field: 'end',
        message: 'ほかの案件と時間が重なっています。',
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function isBetter(candidate, best) {
  if (!best) return true;
  if (candidate.totalMinutes !== best.totalMinutes) return candidate.totalMinutes > best.totalMinutes;
  if (candidate.breaks.length !== best.breaks.length) return candidate.breaks.length < best.breaks.length;
  for (let i = 0; i < candidate.breaks.length; i += 1) {
    if (candidate.breaks[i].start !== best.breaks[i].start) {
      return candidate.breaks[i].start < best.breaks[i].start;
    }
  }
  return false;
}

/**
 * Find the best break plan under the specification.
 * This deliberately enumerates every subset of up to three eligible gaps.
 *
 * @param {Array<{id: string|number, name?: string, start: number, end: number}>} jobs
 * @returns {{status: 'valid'|'invalid'|'impossible', breaks: Array<{start:number,end:number,duration:number}>, totalMinutes:number, count:number, errors:Array}}
 */
export function calculateBreaks(jobs) {
  const validation = validateJobs(jobs);
  if (!validation.valid) return { status: 'invalid', breaks: [], totalMinutes: 0, count: 0, errors: validation.errors };

  const ordered = [...jobs].sort((a, b) => a.start - b.start || a.end - b.end);
  if (ordered.length === 0) {
    return { status: 'valid', breaks: [], totalMinutes: 0, count: 0, errors: [] };
  }

  const candidates = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const start = ordered[i - 1].end + 5;
    const end = ordered[i].start - 5;
    if (end - start >= 10) {
      candidates.push({ start, end, duration: end - start });
    }
  }

  const dayIsShort = ordered[ordered.length - 1].end - ordered[0].start < 300;
  let best = dayIsShort ? { breaks: [], totalMinutes: 0 } : null;

  const visit = (position, selected) => {
    if (selected.length > 0) {
      const first = selected[0];
      const validFirst = first.start - ordered[0].start <= 300;
      const validSpacing = selected.every((item, index) => index === 0 || item.start - selected[index - 1].end <= 300);
      if (validFirst && validSpacing) {
        const plan = {
          breaks: selected.map(({ start, end, duration }) => ({ start, end, duration })),
          totalMinutes: selected.reduce((total, item) => total + item.duration, 0),
        };
        if (isBetter(plan, best)) best = plan;
      }
    }
    if (selected.length === 3) return;
    for (let i = position; i < candidates.length; i += 1) {
      selected.push(candidates[i]);
      visit(i + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);

  if (!best) return { status: 'impossible', breaks: [], totalMinutes: 0, count: 0, errors: [] };
  return { status: 'valid', ...best, count: best.breaks.length, errors: [] };
}

/**
 * Allocate the legally required break total to eligible gaps. All saved times
 * are on a five-minute grid, so the exact total and every interval endpoint
 * can be represented as integer five-minute slots.
 *
 * The score gives later gaps higher priority than all earlier gaps combined.
 * For the same allocation, fewer breaks and later starts win.
 */
export function calculateAllocatedBreaks(jobs) {
  const validation = validateJobs(jobs);
  if (!validation.valid) {
    return { status: 'invalid', breaks: [], count: 0, totalMinutes: 0, actualMinutes: null, maxAvailableMinutes: null, errors: validation.errors };
  }
  if (jobs.length === 0) {
    return { status: 'empty', breaks: [], count: 0, totalMinutes: 0, actualMinutes: null, maxAvailableMinutes: null, errors: [] };
  }

  const ordered = [...jobs].sort((a, b) => a.start - b.start || a.end - b.end);
  const firstStart = ordered[0].start;
  const lastEnd = ordered[ordered.length - 1].end;
  const actualMinutes = Math.max(0, lastEnd + 5 - firstStart - 480);
  const maximum = calculateBreaks(ordered);
  const maxAvailableMinutes = maximum.status === 'valid' ? maximum.totalMinutes : null;
  const base = { actualMinutes, maxAvailableMinutes, errors: [] };
  const impossible = () => ({ status: 'impossible', breaks: [], count: 0, totalMinutes: 0, ...base });

  if (actualMinutes === 0) {
    if (lastEnd - firstStart < 300) {
      return { status: 'valid', breaks: [], count: 0, totalMinutes: 0, ...base };
    }
    return impossible();
  }
  if (actualMinutes < 10 || maxAvailableMinutes === null || actualMinutes > maxAvailableMinutes) return impossible();

  const gaps = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const start = ordered[index - 1].end + 5;
    const end = ordered[index].start - 5;
    if (end - start >= 10) gaps.push({ start: start / 5, end: end / 5 });
  }
  if (gaps.length === 0) return impossible();

  const totalSlots = actualMinutes / 5;
  const firstDeadline = (firstStart + 300) / 5;
  const lastGap = gaps[gaps.length - 1];
  const singleStart = Math.min(lastGap.end - totalSlots, firstDeadline);
  if (singleStart >= lastGap.start) {
    const start = singleStart * 5;
    return {
      status: 'valid', breaks: [{ start, end: start + actualMinutes, duration: actualMinutes }],
      count: 1, totalMinutes: actualMinutes, ...base,
    };
  }

  const gapAtStart = new Int16Array(289).fill(-1);
  for (let index = 0; index < gaps.length; index += 1) {
    for (let start = gaps[index].start; start <= gaps[index].end - 2; start += 1) {
      gapAtStart[start] = index;
    }
  }
  const baseScore = BigInt(totalSlots + 1);
  const weights = gaps.map((_, index) => baseScore ** BigInt(index));
  const latestStart = gaps[gaps.length - 1].end - 2;
  const memo = new Map();

  function better(a, b) {
    if (!b) return true;
    if (a.score !== b.score) return a.score > b.score;
    if (a.count !== b.count) return a.count < b.count;
    for (let index = a.breaks.length - 1; index >= 0; index -= 1) {
      if (a.breaks[index].start !== b.breaks[index].start) {
        return a.breaks[index].start > b.breaks[index].start;
      }
      if (a.breaks[index].end !== b.breaks[index].end) {
        return a.breaks[index].end > b.breaks[index].end;
      }
    }
    return false;
  }

  function solve(previousEnd, remaining, slotsLeft) {
    if (remaining === 0) return { score: 0n, count: 0, breaks: [] };
    if (slotsLeft === 0 || remaining < 2) return null;
    const key = `${previousEnd}:${remaining}:${slotsLeft}`;
    if (memo.has(key)) return memo.get(key);
    let best = null;
    const from = previousEnd < 0 ? gaps[0].start : previousEnd;
    const to = Math.min(latestStart, previousEnd < 0 ? firstDeadline : previousEnd + 60);
    for (let start = from; start <= to; start += 1) {
      const gapIndex = gapAtStart[start];
      if (gapIndex < 0) continue;
      const maxLength = Math.min(remaining, gaps[gapIndex].end - start);
      for (let length = 2; length <= maxLength; length += 1) {
        const end = start + length;
        const tail = solve(end, remaining - length, slotsLeft - 1);
        if (!tail) continue;
        const candidate = {
          score: BigInt(length) * weights[gapIndex] + tail.score,
          count: 1 + tail.count,
          breaks: [{ start: start * 5, end: end * 5, duration: length * 5 }, ...tail.breaks],
        };
        if (better(candidate, best)) best = candidate;
      }
    }
    memo.set(key, best);
    return best;
  }

  const plan = solve(-1, totalSlots, 3);
  if (!plan) return impossible();
  return { status: 'valid', breaks: plan.breaks, count: plan.count, totalMinutes: actualMinutes, ...base };
}
