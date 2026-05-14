import { OHLC, TechnicalSummary } from '../types';

// --- Moving Averages ---

export function SMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

export function EMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < Math.min(period, data.length); i++) {
    sum += data[i];
    result.push(NaN);
  }
  if (data.length >= period) {
    result[period - 1] = sum / period;
    for (let i = period; i < data.length; i++) {
      result.push((data[i] - result[i - 1]) * multiplier + result[i - 1]);
    }
  }
  return result;
}

// --- RSI ---

export function RSI(closes: number[], period: number = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return result;

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  if (gains.length < period) return result;

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result[i + 1] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

// --- MACD ---

export function MACD(closes: number[]): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const ema12 = EMA(closes, 12);
  const ema26 = EMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const validMacd = macdLine.filter((v) => !isNaN(v));
  const signalLine = EMA(validMacd, 9);
  const padded = new Array(macdLine.length - signalLine.length)
    .fill(NaN)
    .concat(signalLine);
  const histogram = macdLine.map((v, i) => v - padded[i]);
  return { macd: macdLine, signal: padded, histogram };
}

// --- Support & Resistance ---

export function findSupportResistance(
  candles: OHLC[],
  lookback: number = 50
): { supports: number[]; resistances: number[] } {
  const recent = candles.slice(-lookback);
  const supports: number[] = [];
  const resistances: number[] = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (
      recent[i].high > recent[i - 1].high &&
      recent[i].high > recent[i - 2].high &&
      recent[i].high > recent[i + 1].high &&
      recent[i].high > recent[i + 2].high
    ) {
      resistances.push(recent[i].high);
    }
    if (
      recent[i].low < recent[i - 1].low &&
      recent[i].low < recent[i - 2].low &&
      recent[i].low < recent[i + 1].low &&
      recent[i].low < recent[i + 2].low
    ) {
      supports.push(recent[i].low);
    }
  }

  return {
    supports: supports.sort((a, b) => b - a),
    resistances: resistances.sort((a, b) => a - b),
  };
}

// --- Volume Analysis ---

export function averageVolume(candles: OHLC[], period: number = 20): number {
  const recent = candles.slice(-period);
  return recent.reduce((s, c) => s + c.volume, 0) / recent.length;
}

// --- Generate Technical Summary for AI ---

export function generateTechnicalSummary(
  candles: OHLC[],
  symbol: string
): TechnicalSummary {
  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];

  const sma200 = SMA(closes, 200);
  const sma50 = SMA(closes, 50);
  const rsi = RSI(closes);
  const macd = MACD(closes);
  const { supports, resistances } = findSupportResistance(candles);
  const avgVol = averageVolume(candles, 20);
  const todayVol = candles[candles.length - 1]?.volume || 0;

  const currentRSI = rsi[rsi.length - 1] || 50;
  const current200DMA = sma200[sma200.length - 1] || 0;
  const current50DMA = sma50[sma50.length - 1] || 0;
  const macdHist = macd.histogram[macd.histogram.length - 1] || 0;

  return {
    symbol,
    currentPrice,
    dma200: current200DMA,
    dma50: current50DMA,
    aboveDma200: currentPrice > current200DMA,
    aboveDma50: currentPrice > current50DMA,
    rsi: currentRSI,
    rsiSignal: currentRSI > 70 ? 'OVERBOUGHT' : currentRSI < 30 ? 'OVERSOLD' : 'NEUTRAL',
    macdSignal: macdHist > 0 ? 'BULLISH' : 'BEARISH',
    supports: supports.slice(0, 3),
    resistances: resistances.slice(0, 3),
    volumeAvg20: avgVol,
    volumeToday: todayVol,
    volumeRatio: avgVol > 0 ? todayVol / avgVol : 0,
  };
}

export function formatTechnicalForAI(summary: TechnicalSummary): string {
  let s = `Technical: ${summary.symbol} (CMP: ₹${summary.currentPrice.toFixed(2)})\n`;
  s += `• 200 DMA: ₹${summary.dma200.toFixed(2)} (${summary.aboveDma200 ? 'ABOVE ✓' : 'BELOW ✗'})\n`;
  s += `• 50 DMA: ₹${summary.dma50.toFixed(2)} (${summary.aboveDma50 ? 'ABOVE ✓' : 'BELOW ✗'})\n`;
  s += `• RSI(14): ${summary.rsi.toFixed(1)} (${summary.rsiSignal})\n`;
  s += `• MACD: ${summary.macdSignal}\n`;
  s += `• Volume: ${summary.volumeRatio.toFixed(1)}x avg (${summary.volumeRatio > 1.5 ? 'HIGH' : 'NORMAL'})\n`;
  if (summary.supports.length) {
    s += `• Supports: ${summary.supports.map((v) => `₹${v.toFixed(0)}`).join(', ')}\n`;
  }
  if (summary.resistances.length) {
    s += `• Resistances: ${summary.resistances.map((v) => `₹${v.toFixed(0)}`).join(', ')}\n`;
  }
  return s;
}
