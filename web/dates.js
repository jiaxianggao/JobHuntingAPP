export function localDateKey(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

export function monthCells(month) {
  const year = month.getFullYear();
  const index = month.getMonth();
  const first = calendarDate(year, index);
  const count = calendarDate(year, index + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, slot) => {
    const day = slot - offset + 1;
    return day >= 1 && day <= count ? calendarDate(year, index, day) : null;
  });
}
export function calendarDate(year, month, day = 1) {
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(year, month, day);
  return date;
}
