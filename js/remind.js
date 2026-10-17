// remind.js — нагадування через календар телефону (без сервера й без нових дозволів).
//
// Подія, що повторюється: «тренування Пн/Ср/Пт о 18:00», «вітаміни щодня о 08:00».
//   Android — вікно «Нова подія» календаря телефону (intent INSERT; людина натискає «Зберегти»).
//     Час нагадування intent задати не вміє — календар бере своє (зазвичай за 30 хв), міняється в тому ж вікні.
//   Інші телефони й комп'ютер — файл .ics з VALARM (нагадування за N хв).
// Пуш-сповіщень від самого застосунку поки немає (рішення 17.10: після схвалення робочої версії в Play).
//
// ev = { title, desc, date: 'YYYY-MM-DD' (перший раз), time: 'HH:MM', minutes (тривалість),
//        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' | 'FREQ=DAILY' …, alarm: хвилин до початку (0 — у момент початку) }

export const isAndroid = /Android/i.test(navigator.userAgent || '');
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // індекс = Date.getDay()

const pad = (n) => String(n).padStart(2, '0');
function startDate(ev) {
  const [y, m, d] = ev.date.split('-').map(Number);
  const [hh, mm] = ev.time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0);
}

/** Правило «щотижня в ці дні» (dows — 0..6, 0 = неділя). */
export function weeklyRule(dows) {
  return 'FREQ=WEEKLY;BYDAY=' + [...new Set(dows)].sort().map((d) => BYDAY[d]).join(',');
}
/** Перша дата від сьогодні (включно), що припадає на один із днів тижня. */
export function firstDate(dows, fromISO) {
  const d = fromISO ? new Date(fromISO + 'T12:00:00') : new Date();
  for (let i = 0; i < 7; i++) {
    if (dows.includes(d.getDay())) break;
    d.setDate(d.getDate() + 1);
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Кінець повторів (останній день, 'YYYY-MM-DD') → частина правила UNTIL. */
export function untilPart(endISO) {
  return endISO ? ';UNTIL=' + endISO.replace(/-/g, '') + 'T235959' : '';
}

function intentURL(ev) {
  const begin = startDate(ev).getTime();
  const end = begin + (ev.minutes || 60) * 60000;
  const e = encodeURIComponent;
  return 'intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.item/event;'
    + `S.title=${e(ev.title)};S.description=${e(ev.desc || '')};`
    + `l.beginTime=${begin};l.endTime=${end};S.rrule=${e(ev.rrule)};end`;
}

const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsStamp(dt, utc) {
  if (utc) return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
}
export function buildICS(events) {
  const now = new Date();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gym Log//Reminders//UK', 'CALSCALE:GREGORIAN'];
  events.forEach((ev, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:gymlog-${now.getTime()}-${i}@gymlog`,
      `DTSTAMP:${icsStamp(now, true)}`,
      `DTSTART:${icsStamp(startDate(ev))}`,
      `DURATION:PT${ev.minutes || 60}M`,
      `RRULE:${ev.rrule}`,
      `SUMMARY:${icsText(ev.title)}`,
      `DESCRIPTION:${icsText(ev.desc)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(ev.title)}`,
      `TRIGGER:-PT${Math.max(0, ev.alarm || 0)}M`,
      'END:VALARM',
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
export function downloadICS(events, name) {
  const blob = new Blob([buildICS(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (name || 'gymlog') + '.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Додати одну подію: Android — вікно календаря, інакше — файл .ics. */
export function addToCalendar(ev, name) {
  if (isAndroid) location.href = intentURL(ev);
  else downloadICS([ev], name);
}
