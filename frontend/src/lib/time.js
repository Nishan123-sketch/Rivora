// Observation/forecast SQL DATETIME values use Asia/Seoul. Explicit zones stay intact.
export function parseTime(value) {
  if (value instanceof Date) return value;
  if (!value) return new Date(NaN);
  const text = String(value).trim().replace(' ', 'T');
  return new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text) ? text + '+09:00' : text);
}
