'use strict';

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const DAYS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS },
  { name: 'dow', min: 0, max: 7, names: DAYS },
];

function invalid(expression) {
  return new Error(`invalid cron: ${expression}`);
}

function parseValue(text, field, expression) {
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (n < field.min || n > field.max) throw invalid(expression);
    return n;
  }
  if (field.names && Object.prototype.hasOwnProperty.call(field.names, text.toUpperCase()) && /^[A-Za-z]{3}$/.test(text)) {
    return field.names[text.toUpperCase()];
  }
  throw invalid(expression);
}

function parseField(text, field, expression) {
  const set = new Set();
  if (text === '') throw invalid(expression);
  for (const item of text.split(',')) {
    if (item === '') throw invalid(expression);
    const [range, step, extra] = item.split('/');
    if (extra !== undefined) throw invalid(expression);
    let from;
    let to;
    if (range === '*') {
      from = field.min;
      to = field.name === 'dow' ? 6 : field.max;
    } else if (range.includes('-')) {
      const parts = range.split('-');
      if (parts.length !== 2) throw invalid(expression);
      from = parseValue(parts[0], field, expression);
      to = parseValue(parts[1], field, expression);
      if (from > to) throw invalid(expression);
    } else {
      from = parseValue(range, field, expression);
      to = step === undefined ? from : field.max;
    }
    let stepN = 1;
    if (step !== undefined) {
      if (!/^\d+$/.test(step) || Number(step) < 1) throw invalid(expression);
      if (field.names && /[A-Za-z]/.test(step)) throw invalid(expression);
      stepN = Number(step);
    }
    for (let v = from; v <= to; v += stepN) set.add(field.name === 'dow' && v === 7 ? 0 : v);
  }
  return set;
}

function parse(expression) {
  if (typeof expression !== 'string') throw new Error(`invalid cron: ${expression}`);
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw invalid(expression);
  const sets = parts.map((p, i) => parseField(p, FIELDS[i], expression));
  return { minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4], domStar: parts[2].startsWith('*'), dowStar: parts[4].startsWith('*') };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayMatches(c, year, month, day) {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const domOk = c.dom.has(day);
  const dowOk = c.dow.has(dow);
  return c.domStar || c.dowStar ? domOk && dowOk : domOk || dowOk;
}

function nextRun(expression, after) {
  const c = parse(expression);
  let ms;
  if (after instanceof Date) ms = after.getTime();
  else if (typeof after === 'number') ms = after;
  else throw new TypeError('after must be a Date or a number of milliseconds');
  if (!Number.isFinite(ms)) throw new TypeError('after must be a Date or a number of milliseconds');

  const start = new Date(Math.floor(ms / 60000) * 60000 + 60000);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  let day = start.getUTCDate();
  let hour = start.getUTCHours();
  let minute = start.getUTCMinutes();
  const limit = year + 9;

  while (year <= limit) {
    if (!c.month.has(month)) {
      month += 1;
      day = 1;
      hour = 0;
      minute = 0;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      continue;
    }
    if (day > daysInMonth(year, month)) {
      day = 1;
      hour = 0;
      minute = 0;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      continue;
    }
    if (!dayMatches(c, year, month, day)) {
      day += 1;
      hour = 0;
      minute = 0;
      continue;
    }
    if (!c.hour.has(hour)) {
      hour += 1;
      minute = 0;
      if (hour > 23) {
        hour = 0;
        day += 1;
      }
      continue;
    }
    if (!c.minute.has(minute)) {
      minute += 1;
      if (minute > 59) {
        minute = 0;
        hour += 1;
        if (hour > 23) {
          hour = 0;
          day += 1;
        }
      }
      continue;
    }
    return new Date(Date.UTC(year, month - 1, day, hour, minute));
  }
  return null;
}

module.exports = { nextRun };
