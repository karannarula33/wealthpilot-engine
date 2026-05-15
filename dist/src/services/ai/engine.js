import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { db } from '../../db/client';
import { buildSystemPrompt, buildAnalysisPrompt } from './prompts';
const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
// Initialize Gemini (only if key exists to avoid crash if reverting)
const genAI = new GoogleGenerativeAI(config.gemini?.apiKey || '');
export class AIEngine {
    async analyze(input) {
        const systemPrompt = buildSystemPrompt();
        const startTime = Date.now();
        try {
            let text;
            let usage;
            if (config.aiProvider === 'gemini') {
                // ============================================
                // NEW GEMINI ENGINE
                // ============================================
                const model = genAI.getGenerativeModel({
                    model: config.gemini.model,
                    systemInstruction: systemPrompt,
                    generationConfig: {
                        responseMimeType: "application/json",
                    }
                });
                const userPromptText = `
${input.portfolioContext}

${buildAnalysisPrompt({
                    eventType: input.eventType,
                    eventContext: input.eventContext,
                    marketContext: input.marketContext,
                    technicalData: input.technicalData,
                    newsContext: input.newsContext,
                    userQuery: input.userQuery,
                })}
`;
                const result = await model.generateContent(userPromptText);
                text = result.response.text();
                // Compute Gemini-specific usage and cost
                const usageMetadata = result.response.usageMetadata;
                const inputTokens = usageMetadata?.promptTokenCount || 0;
                const outputTokens = usageMetadata?.candidatesTokenCount || 0;
                const inputCost = (inputTokens / 1_000_000) * 0.075;
                const outputCost = (outputTokens / 1_000_000) * 0.30;
                usage = {
                    inputTokens,
                    outputTokens,
                    cacheReadTokens: 0,
                    cacheCreateTokens: 0,
                    costUsd: inputCost + outputCost,
                    latencyMs: Date.now() - startTime,
                };
            }
            else {
                // ============================================
                // ORIGINAL CLAUDE ENGINE (UNTOUCHED)
                // ============================================
                const response = await anthropic.messages.create({
                    model: config.anthropic.model,
                    max_tokens: config.anthropic.maxTokens,
                    system: [
                        {
                            type: 'text',
                            text: systemPrompt,
                            cache_control: { type: 'ephemeral' },
                        },
                    ],
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: input.portfolioContext,
                                    cache_control: { type: 'ephemeral' },
                                },
                                {
                                    type: 'text',
                                    text: buildAnalysisPrompt({
                                        eventType: input.eventType,
                                        eventContext: input.eventContext,
                                        marketContext: input.marketContext,
                                        technicalData: input.technicalData,
                                        newsContext: input.newsContext,
                                        userQuery: input.userQuery,
                                    }),
                                },
                            ],
                        },
                    ],
                });
                text = response.content
                    .filter((b) => b.type === 'text')
                    .map((b) => b.text)
                    .join('');
                usage = this.computeUsage(response.usage, startTime);
            }
            // === SHARED PARSING AND DB LOGIC (UNTOUCHED) ===
            const analysis = this.parseResponse(text);
            logger.info('AI analysis complete', {
                provider: config.aiProvider || 'anthropic',
                eventType: input.eventType,
                action: analysis.action,
                conviction: analysis.conviction,
                costUsd: usage.costUsd.toFixed(4),
                latencyMs: usage.latencyMs,
                cacheHit: usage.cacheReadTokens > 0,
            });
            // Store recommendation in DB
            let recommendationId;
            if (analysis.action !== 'NO_ACTION') {
                const rec = await db.saveRecommendation({
                    user_id: input.userId || null,
                    trigger_type: input.eventType,
                    trigger_context: { eventContext: input.eventContext },
                    symbol: analysis.symbols?.[0] || null,
                    action: analysis.action,
                    conviction: analysis.conviction,
                    priority: analysis.priority,
                    summary: analysis.summary,
                    reasoning: analysis.reasoning,
                    alternatives: analysis.alternatives,
                    educational_note: analysis.educationalNote,
                    tax_impact: analysis.taxImpact,
                    raw_ai_response: { text },
                    tokens_used: usage,
                    user_action: 'PENDING',
                });
                recommendationId = rec?.id;
            }
            return { analysis, usage, recommendationId };
        }
        catch (error) {
            logger.error('AI analysis failed', {
                error: error.message,
                eventType: input.eventType,
                provider: config.aiProvider || 'anthropic'
            });
            // Return safe fallback
            return {
                analysis: {
                    action: 'NO_ACTION',
                    conviction: 1,
                    priority: 'LOW',
                    summary: 'Analysis temporarily unavailable',
                    reasoning: `AI engine error: ${error.message}. Will retry on next scheduled run.`,
                    alternatives: [],
                    educationalNote: '',
                },
                usage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreateTokens: 0,
                    costUsd: 0,
                    latencyMs: Date.now() - startTime,
                },
            };
        }
    }
    /**
     * Convenience method for user queries via WhatsApp
     */
    async answerQuery(userId, query, portfolioContext, marketContext) {
        const { analysis } = await this.analyze({
            eventType: 'USER_QUERY',
            eventContext: 'User asked a question via WhatsApp.',
            portfolioContext,
            marketContext,
            userQuery: query,
            userId,
        });
        return analysis;
    }
    // Original Claude Parser (Untouched)
    parseResponse(text) {
        try {
            // Extract JSON — handle markdown code blocks
            const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                throw new Error('No JSON found in AI response');
            const parsed = JSON.parse(jsonMatch[0]);
            // Validate required fields
            if (!parsed.action || !parsed.summary || !parsed.reasoning) {
                throw new Error('Missing required fields');
            }
            return {
                action: parsed.action,
                conviction: Math.min(5, Math.max(1, Number(parsed.conviction) || 3)),
                priority: parsed.priority || 'MEDIUM',
                summary: parsed.summary,
                reasoning: parsed.reasoning,
                alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
                educationalNote: parsed.educationalNote || '',
                taxImpact: parsed.taxImpact,
                symbols: Array.isArray(parsed.symbols) ? parsed.symbols : [],
            };
        }
        catch (error) {
            logger.error('Failed to parse AI response', { error: error.message, text: text.slice(0, 500) });
            return {
                action: 'NO_ACTION',
                conviction: 1,
                priority: 'LOW',
                summary: 'Analysis response could not be parsed',
                reasoning: 'The AI returned an unexpected format. This will be retried.',
                alternatives: [],
                educationalNote: '',
            };
        }
    }
    // Original Claude Usage Calculator (Untouched)
    computeUsage(usage, startTime) {
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheCreate = usage.cache_creation_input_tokens || 0;
        // Sonnet 4.6: $3/$15 per MTok, cache read 0.1x, cache write 1.25x
        const inputCost = (inputTokens / 1_000_000) * 3;
        const outputCost = (outputTokens / 1_000_000) * 15;
        const cacheReadCost = (cacheRead / 1_000_000) * 0.3;
        const cacheWriteCost = (cacheCreate / 1_000_000) * 3.75;
        return {
            inputTokens,
            outputTokens,
            cacheReadTokens: cacheRead,
            cacheCreateTokens: cacheCreate,
            costUsd: inputCost + outputCost + cacheReadCost + cacheWriteCost,
            latencyMs: Date.now() - startTime,
        };
    }
}
