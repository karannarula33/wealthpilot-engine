import { AIAnalysisOutput } from '../../types';

const CONVICTION_EMOJI: Record<number, string> = {
  1: '⚪', 2: '🟡', 3: '🟠', 4: '🔵', 5: '🟣',
};

function convictionLabel(score: number): string {
  return `${CONVICTION_EMOJI[score] || '⚪'} ${score}/5`;
}

function formatLakhs(v: number): string {
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${v.toFixed(0)}`;
}

// --- Morning Prep (8:30 AM) ---

export function formatMorningPrep(
  analysis: AIAnalysisOutput,
  marketContext: string,
  portfolioValue?: number
): string {
  const date = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

  let msg = `📊 Morning Prep — ${date}\n\n`;

  // Extract key market data from context (simplified parsing)
  msg += `${marketContext.split('\n').slice(0, 8).join('\n')}\n\n`;

  // AI analysis
  if (analysis.action !== 'NO_ACTION') {
    msg += `SIGNAL [${convictionLabel(analysis.conviction)}]\n`;
    msg += `${analysis.summary}\n\n`;
    msg += `WHY: ${analysis.reasoning}\n`;
  } else {
    msg += `${analysis.summary}\n`;
  }

  msg += `\nReply DETAILS for full analysis.`;
  return msg;
}

// --- Post-Settle Brief (9:45 AM) ---

export function formatPostSettle(
  analysis: AIAnalysisOutput,
  portfolioContext: string,
  marketContext: string
): string {
  let msg = `🎯 Market Open Brief — 9:45 AM\n\n`;

  // Portfolio headline (extract from context)
  const valueLine = portfolioContext.match(/Total Value: (₹[\d.]+[LK]?)/);
  if (valueLine) {
    msg += `YOUR PORTFOLIO: ${valueLine[1]}\n\n`;
  }

  // Main signal
  if (analysis.action !== 'NO_ACTION' && analysis.symbols?.length) {
    msg += `⚡ ${analysis.symbols[0]} [${convictionLabel(analysis.conviction)}]\n`;
    msg += `${analysis.summary}\n\n`;
    msg += `WHY: ${analysis.reasoning}\n\n`;
  }

  // Alternatives
  if (analysis.alternatives?.length > 0) {
    msg += `OTHER OPTIONS:\n`;
    for (const alt of analysis.alternatives) {
      msg += `• ${alt.option} — ${alt.tradeoff}\n`;
    }
    msg += `\n`;
  }

  // Actions
  msg += `ACTIONS TODAY\n`;
  if (analysis.action !== 'NO_ACTION') {
    msg += `1. ${analysis.symbols?.[0] || 'Portfolio'}: ${analysis.summary}\n`;
  } else {
    msg += `No immediate actions needed.\n`;
  }

  msg += `\nReply DETAILS for full analysis or STATUS for portfolio snapshot.`;
  return msg;
}

// --- Intraday Alert ---

export function formatIntradayAlert(
  analysis: AIAnalysisOutput,
  triggerType: string,
  triggerDetails: string
): string {
  const priorityEmoji: Record<string, string> = {
    HIGH: '🚨', MEDIUM: '⚠️', LOW: '💡', INFO: 'ℹ️',
  };
  const emoji = priorityEmoji[analysis.priority] || '📌';

  let msg = `${emoji} ALERT: ${analysis.symbols?.[0] || 'Portfolio'}\n\n`;
  msg += `${triggerDetails}\n\n`;

  msg += `ACTION [${convictionLabel(analysis.conviction)}]: ${analysis.summary}\n\n`;
  msg += `WHY: ${analysis.reasoning}\n`;

  if (analysis.taxImpact && analysis.taxImpact.type !== 'NA') {
    msg += `\nTAX: ${analysis.taxImpact.type}`;
    if (analysis.taxImpact.estimatedAmount) {
      msg += ` — Est. impact: ${formatLakhs(analysis.taxImpact.estimatedAmount)}`;
    }
    msg += `\n`;
  }

  if (analysis.educationalNote) {
    msg += `\n💡 ${analysis.educationalNote}\n`;
  }

  msg += `\nReply YES to act, SKIP to dismiss, or DETAILS for more.`;
  return msg;
}

// --- Evening Wrap (4:30 PM) ---

export function formatEveningWrap(
  analysis: AIAnalysisOutput,
  todayRecs: any[],
  portfolioContext: string
): string {
  const date = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

  let msg = `🌅 Day Wrap — ${date}\n\n`;

  // Portfolio headline
  const valueLine = portfolioContext.match(/Total Value: (₹[\d.]+[LK]?)/);
  if (valueLine) {
    msg += `PORTFOLIO: ${valueLine[1]}\n\n`;
  }

  // AI summary of the day
  msg += `${analysis.reasoning}\n\n`;

  // Today's recommendations tracking
  if (todayRecs.length > 0) {
    msg += `TODAY'S CALLS\n`;
    for (const r of todayRecs) {
      const statusEmoji = r.user_action === 'ACTED' ? '✅' :
        r.user_action === 'SKIPPED' ? '⏭️' : '⏸️';
      msg += `${statusEmoji} ${r.symbol || 'Portfolio'}: ${r.summary} [${r.conviction}/5]\n`;
    }
    msg += `\n`;
  }

  // Tomorrow watch
  if (analysis.educationalNote) {
    msg += `TOMORROW WATCH\n${analysis.educationalNote}\n\n`;
  }

  msg += `Reply JOURNAL to log your notes for today.`;
  return msg;
}

// --- Weekly Digest (Saturday 10 AM) ---

export function formatWeeklyDigest(
  analysis: AIAnalysisOutput,
  weekRecs: any[],
  portfolioContext: string,
  weekPerformance?: { changePct: number }
): string {
  let msg = `📋 Weekly Review\n\n`;

  const valueLine = portfolioContext.match(/Total Value: (₹[\d.]+[LK]?)/);
  if (valueLine) {
    msg += `PORTFOLIO: ${valueLine[1]}`;
    if (weekPerformance) {
      msg += ` (${weekPerformance.changePct >= 0 ? '+' : ''}${weekPerformance.changePct.toFixed(1)}% this week)`;
    }
    msg += `\n\n`;
  }

  // Week's calls review
  if (weekRecs.length > 0) {
    const acted = weekRecs.filter((r) => r.user_action === 'ACTED');
    const profitable = acted.filter((r) => r.outcome_result === 'PROFITABLE');

    msg += `THIS WEEK'S CALLS\n`;
    for (const r of weekRecs.slice(0, 8)) {
      const emoji = r.user_action === 'ACTED'
        ? (r.outcome_result === 'PROFITABLE' ? '✅' : r.outcome_result === 'LOSS' ? '❌' : '⏳')
        : '⏭️';
      msg += `${emoji} ${r.symbol || 'Portfolio'}: ${r.action} [${r.conviction}/5] — ${r.user_action || 'PENDING'}\n`;
    }

    msg += `\nACCURACY: ${acted.length} acted | ${profitable.length} profitable`;
    if (acted.length > 0) {
      msg += ` (${((profitable.length / acted.length) * 100).toFixed(0)}%)`;
    }
    msg += `\n\n`;
  }

  // AI weekly insights
  msg += `INSIGHTS\n${analysis.reasoning}\n\n`;

  if (analysis.educationalNote) {
    msg += `NEXT WEEK\n${analysis.educationalNote}\n\n`;
  }

  msg += `Reply PLAN to discuss next week's strategy.`;
  return msg;
}

// --- User Query Response ---

export function formatQueryResponse(analysis: AIAnalysisOutput): string {
  let msg = '';

  if (analysis.action !== 'NO_ACTION' && analysis.symbols?.length) {
    msg += `${analysis.symbols[0]}: ${analysis.action} [${convictionLabel(analysis.conviction)}]\n\n`;
  }

  msg += `${analysis.reasoning}\n`;

  if (analysis.alternatives?.length) {
    msg += `\nAlternatives:\n`;
    for (const alt of analysis.alternatives) {
      msg += `• ${alt.option}: ${alt.tradeoff}\n`;
    }
  }

  if (analysis.educationalNote) {
    msg += `\n💡 ${analysis.educationalNote}`;
  }

  return msg;
}

// --- Status Message ---

export function formatStatusMessage(
  holdings: any[],
  totalValue: number
): string {
  let msg = `📊 Portfolio Status\n\n`;
  msg += `Total: ${formatLakhs(totalValue)}\n\n`;

  for (const h of holdings.slice(0, 12)) {
    const emoji = (h.unrealized_pnl_pct || 0) >= 0 ? '🟢' : '🔴';
    msg += `${emoji} ${h.symbol || h.name}: ${formatLakhs(h.current_value || 0)} (${(h.unrealized_pnl_pct || 0).toFixed(1)}%)\n`;
  }

  if (holdings.length > 12) {
    msg += `\n...and ${holdings.length - 12} more positions`;
  }

  return msg;
}

// --- Help Text ---

export function formatHelpText(): string {
  return `📖 WealthPilot Commands\n\n` +
    `DETAILS — Full analysis of last alert\n` +
    `YES — Log that you acted on it\n` +
    `SKIP — Dismiss the recommendation\n` +
    `STATUS — Current portfolio snapshot\n` +
    `QUIET — Suppress intraday alerts today\n` +
    `JOURNAL — Log your notes for today\n` +
    `PLAN — Discuss strategy with AI\n` +
    `HELP — This message\n\n` +
    `Or type any question about your portfolio!`;
}
