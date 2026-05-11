import OpenAI from 'openai';
import { ICON_KEYS, type IconKey, isIconKey } from '../entrypoints/icons';
import { derror } from './debugLog';

export type GeneratedSuggestion = {
  prompt: string;
  title: string;
  hint: string;
  icon: IconKey;
};

export type GenerateSuggestionsArgs = {
  apiKey: string;
  model: string;
  recordContextJson: string;
  signal?: AbortSignal;
};

const SYSTEM_INSTRUCTIONS = `You generate prompt suggestions for a chat sidebar embedded in the DatoCMS record editor.

Given the record the user is currently editing, propose exactly 4 short, concrete prompts the user is likely to want right now. The snapshot includes capped current editor values under live.values. Tailor suggestions to this specific model's fields and to the record's current state:
- Flag empty fields that look important (title, slug, excerpt, meta, body, etc.).
- Suggest tightening or summarizing long values.
- Propose SEO/meta checks when the model has seo-related fields.
- Propose structure improvements (headings, bullets, readability) for long body copy.
- When fields look ready, propose a "prepare for publish" style review.

Each suggestion must have:
- "prompt": the imperative sentence the user would send (≤200 chars).
- "title": 2–4 words, ≤40 chars.
- "hint": 3–7 words, ≤60 chars, no trailing punctuation.
- "icon": pick the single closest match from the enum.

Rules:
- Editing content in any locale (including localized field values) is in scope. Suggestions like "rewrite the Italian title" or "tighten the German body" are fine when that locale's value is present.
- Do NOT propose automated source→target translation (e.g. "translate the English body into Italian"). That's out of scope for this plugin.
- Never reference a field the record doesn't have.
- Don't propose destructive actions (delete, destroy).
- Vary the 4 suggestions; don't repeat the same action with different wording.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'title', 'hint', 'icon'],
        properties: {
          prompt: { type: 'string', maxLength: 200 },
          title: { type: 'string', maxLength: 40 },
          hint: { type: 'string', maxLength: 60 },
          icon: { type: 'string', enum: [...ICON_KEYS] },
        },
      },
    },
  },
} as const;

export async function generateSuggestions(
  args: GenerateSuggestionsArgs,
): Promise<GeneratedSuggestion[]> {
  const client = new OpenAI({
    apiKey: args.apiKey,
    dangerouslyAllowBrowser: true,
  });

  const response = await client.responses.create(
    {
      model: args.model,
      instructions: SYSTEM_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: `Record the user is currently editing (capped current editor values):\n\n\`\`\`json\n${args.recordContextJson}\n\`\`\`\n\nReturn 4 tailored suggestions.`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'suggestions_v1',
          strict: true,
          schema: SCHEMA,
        },
      },
    },
    { signal: args.signal },
  );

  const raw = response.output_text;
  if (!raw) {
    const error = new Error('Mini model returned an empty response');
    derror('Suggestions', 'generate_record:empty', error);
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = validateSuggestions(parsed);
    return result;
  } catch (error) {
    derror('Suggestions', 'generate_record:parse_failure', error, {
      rawPreview: raw.slice(0, 200),
    });
    throw error;
  }
}

function validateSuggestions(value: unknown): GeneratedSuggestion[] {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected an object from the mini model');
  }
  const record = value as Record<string, unknown>;
  const list = record.suggestions;
  if (!Array.isArray(list) || list.length !== 4) {
    throw new Error('Expected exactly 4 suggestions');
  }

  return list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Suggestion #${index} is not an object`);
    }
    const obj = entry as Record<string, unknown>;
    const prompt = obj.prompt;
    const title = obj.title;
    const hint = obj.hint;
    const icon = obj.icon;
    if (
      typeof prompt !== 'string' ||
      typeof title !== 'string' ||
      typeof hint !== 'string' ||
      !isIconKey(icon)
    ) {
      throw new Error(`Suggestion #${index} has invalid fields`);
    }
    return { prompt, title, hint, icon };
  });
}
