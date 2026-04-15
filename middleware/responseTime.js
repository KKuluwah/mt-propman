// Rolling window of last 1000 response times
const responseTimes = [];
const MAX_SAMPLES = 1000;

export const responseTimeMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    responseTimes.push(ms);
    if (responseTimes.length > MAX_SAMPLES) responseTimes.shift();
  });
  next();
};

export function getResponseTimeStats() {
  if (responseTimes.length === 0) return { avg: 0, p95: 0, p99: 0, samples: 0 };
  const sorted = [...responseTimes].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return {
    avg: Math.round(avg * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
    p99: Math.round(p99 * 100) / 100,
    samples: sorted.length
  };
}
