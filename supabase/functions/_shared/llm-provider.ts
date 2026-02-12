/**
 * LLM Provider Interface
 *
 * Provider-agnostic interface for calling LLMs.
 * Supports Anthropic Claude and OpenAI GPT models.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface LLMProvider {
  name: string;
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}

// ============================================================================
// Anthropic Provider
// ============================================================================

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = "claude-3-5-haiku-20241022") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const systemMessage = messages.find((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature ?? 0.3,
        system: systemMessage?.content,
        messages: otherMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      content: data.content[0]?.text || "",
      usage: {
        input_tokens: data.usage?.input_tokens || 0,
        output_tokens: data.usage?.output_tokens || 0,
      },
    };
  }
}

// ============================================================================
// OpenAI Provider
// ============================================================================

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = "gpt-4o-mini") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.3,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    // Enable JSON mode if requested
    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      content: data.choices[0]?.message?.content || "",
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createLLMProvider(): LLMProvider {
  // Check for Anthropic key first (preferred for cost)
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (anthropicKey) {
    const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-3-5-haiku-20241022";
    return new AnthropicProvider(anthropicKey, model);
  }

  // Fall back to OpenAI
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (openaiKey) {
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
    return new OpenAIProvider(openaiKey, model);
  }

  throw new Error("No LLM API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
}
