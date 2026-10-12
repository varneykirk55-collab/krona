import OpenAI from 'openai';
import type { Config } from '../config.js';
import { assert, AppError } from '../errors.js';
export interface AIOutput {
  type: string;
  [key: string]: any;
}
export interface AIResult {
  output: AIOutput[];
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export interface CompletionRequest {
  instructions: string;
  input: any[];
  tools: any[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}
export interface ConversationProvider {
  name: string;
  available: boolean;
  complete(request: CompletionRequest): Promise<AIResult>;
  embed?(text: string): Promise<{ vector: number[]; tokens: number }>;
}
export class OpenAIProvider implements ConversationProvider {
  name = 'openai';
  private client: OpenAI | null;
  constructor(private config: Config) {
    this.client = config.openaiApiKey
      ? new OpenAI({ apiKey: config.openaiApiKey, maxRetries: 0, timeout: 30000 })
      : null;
  }
  get available() {
    return !!this.client && this.config.liveAI;
  }
  async complete(request: CompletionRequest): Promise<AIResult> {
    assert(
      this.available,
      503,
      'AI_NOT_CONFIGURED',
      'AI conversation is implemented but disabled. Configure OpenAI credentials, pricing estimates and ENABLE_LIVE_AI to activate it.',
    );
    try {
      const response = await this.client!.responses.create(
        {
          model: this.config.textModel,
          instructions: request.instructions,
          input: request.input,
          tools: request.tools.map((t) => ({ ...t, strict: false })),
          max_output_tokens: request.maxOutputTokens,
          store: false,
        },
        { signal: request.signal },
      );
      return {
        output: response.output as AIOutput[],
        text: response.output_text,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        503,
        'AI_PROVIDER_UNAVAILABLE',
        'The AI provider did not complete this request. Check credentials, billing and provider availability. No automatic paid retry was attempted.',
      );
    }
  }
  async embed(text: string) {
    assert(
      this.available && this.config.semanticSearch,
      503,
      'SEMANTIC_SEARCH_DISABLED',
      'Semantic search is not enabled.',
    );
    const response = await this.client!.embeddings.create({
      model: this.config.embeddingModel,
      input: text,
      dimensions: 1536,
    });
    return { vector: response.data[0].embedding, tokens: response.usage.total_tokens };
  }
}
