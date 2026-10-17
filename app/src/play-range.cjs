'use strict';

const fullRange = () => ({ startMs: 0, endMs: null });
function validatePlayRange(value, durationMs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('播放范围无效');
  const start = value.startMs === undefined ? 0 : value.startMs;
  const end = value.endMs === undefined ? null : value.endMs;
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 ||
      (end !== null && (typeof end !== 'number' || !Number.isFinite(end) || end < 0))) throw new Error('播放时间必须是非负数');
  const range = { startMs: Math.round(start), endMs: end === null ? null : Math.round(end) };
  if(range.startMs===0&&range.endMs===null)return range;
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null;
  if (duration !== null && (range.startMs >= duration || range.endMs !== null && range.endMs > duration)) throw new Error('播放范围不能超过歌曲时长');
  const effectiveEnd = range.endMs ?? duration;
  if (effectiveEnd !== null && effectiveEnd - range.startMs < 1000) throw new Error('播放范围至少需要 1 秒');
  return range;
}
function normalisePlayRange(value, durationMs) {
  if (value === undefined || value === null) return fullRange();
  try { return validatePlayRange(value, durationMs); } catch { return fullRange(); }
}
function effectivePlayRange(track, durationMs) {
  const range = normalisePlayRange(track?.playRange);
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : Number(track?.durationMs) > 0 ? Number(track.durationMs) : null;
  return { startMs: range.startMs, endMs: duration !== null ? Math.min(range.endMs ?? duration, duration) : range.endMs };
}
function clampToPlayRange(positionMs, range) {
  return Math.max(range.startMs, Math.min(range.endMs ?? Infinity, Number(positionMs) || 0));
}
module.exports = { validatePlayRange, normalisePlayRange, effectivePlayRange, clampToPlayRange };
