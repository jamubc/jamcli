import { z } from 'zod';
import { PERMISSION_MODES, type PermissionMode } from '../permissions/modes.js';

/**
 * The shape of every file JamCLI reads its configuration from. These schemas are the
 * source of truth: `docs/config.schema.json` is generated from them, and a file that does
 * not match is reported by file, key, and expected shape.
 */

/** A message the validator reports as the expected shape, in place of Zod's own. */
const expected = (shape: string) => ({ error: `expected ${shape}` });
const positiveInt = () => {
  const shape = expected('a whole number above zero');
  return z.number(shape).int(shape).positive(shape);
};
const nonNegativeInt = () => {
  const shape = expected('a whole number of 0 or more');
  return z.number(shape).int(shape).nonnegative(shape);
};
const ruleList = (decision: string) => z.array(z.string()).describe(`Rules that ${decision}, such as "run_command(npm test *)". Lists from every layer apply.`);

const keyed = {
  api_key: z.string().describe('A key stored in the file. Prefer key_env_var, so the key stays out of files.'),
  key_env_var: z.string().describe('The environment variable holding the key.'),
  base_url: z.string().describe('The API base URL.'),
};

export const EndpointSchema = z.strictObject({
  id: z.string().min(1).describe('The provider name models are addressed by, as in "id:model".'),
  base_url: z.string().min(1),
  dialect: z.enum(['openai', 'anthropic']).optional().describe('The wire format. Defaults to openai.'),
  api_key: keyed.api_key.optional(),
  key_env_var: keyed.key_env_var.optional(),
  headers: z.record(z.string(), z.string()).optional().describe('Headers sent with every request.'),
});

export const ApiRegistrySchema = z
  .strictObject({
    ollama: z
      .strictObject({
        endpoint: z.string().describe('Where Ollama listens. Defaults to http://localhost:11434.'),
        base_url: z.string(),
        num_ctx: positiveInt().describe('The context window Ollama allocates for every request.'),
      })
      .partial(),
    openai: z.strictObject(keyed).partial(),
    anthropic: z.strictObject(keyed).partial(),
    openrouter: z
      .strictObject({
        ...keyed,
        referer: z.string().describe('Sent as HTTP-Referer, for OpenRouter attribution.'),
        title: z.string().describe('Sent as X-Title, for OpenRouter attribution.'),
      })
      .partial(),
    endpoints: z.array(EndpointSchema).describe('Other OpenAI or Anthropic compatible endpoints.'),
  })
  .partial()
  .describe('Where each provider is and how to authenticate to it.');

export const ModelSettingsSchema = z
  .strictObject({
    context_window: positiveInt().describe('Tokens the model accepts in one request.'),
    max_output: positiveInt().describe('Most tokens the model writes in one reply.'),
    tools: z.boolean(),
    reasoning: z.boolean(),
    images: z.boolean(),
    thinking: z.enum(['adaptive', 'budget']),
    always_thinks: z.boolean(),
    effort: z.boolean(),
    price: z
      .strictObject({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cache_read: z.number().nonnegative().optional(),
        cache_write: z.number().nonnegative().optional(),
      })
      .describe('US dollars per million tokens.'),
  })
  .partial();

export const PermissionSettingsSchema = z
  .strictObject({
    allow: ruleList('allow a call without asking'),
    ask: ruleList('ask before a call'),
    deny: ruleList('refuse a call; a deny always wins'),
    mode: z.enum(PERMISSION_MODES as [PermissionMode, ...PermissionMode[]]).describe('The mode a session starts in.'),
  })
  .partial();

export const SandboxSettingsSchema = z
  .strictObject({
    enabled: z.boolean().describe('On by default wherever a sandbox works.'),
    network: z.boolean().describe('Let sandboxed commands reach the network. Off by default.'),
    writable: z.array(z.string()).describe('Directories besides the project and the temporary directory that commands may write.'),
    hidden: z.array(z.string()).describe('Paths hidden from commands in addition to the defaults.'),
    env: z.enum(['scrubbed', 'minimal']).describe('How much of the environment commands and servers inherit.'),
    env_passthrough: z.array(z.string()).describe('Variables passed to every process by name.'),
  })
  .partial();

export const AgentLoopSchema = z
  .strictObject({
    max_steps: positiveInt().describe('Model requests per user turn before the loop stops.'),
    max_tool_calls_per_turn: nonNegativeInt().describe('Tool calls per turn; 0 means no cap beyond the step limit.'),
    tool_result_max_chars: positiveInt().describe('Characters of one tool result kept in context.'),
    command_timeout_ms: positiveInt().describe('Default timeout for a command.'),
    max_output_tokens: positiveInt().describe("Output tokens to ask for per reply, capped by the model's own limit."),
  })
  .partial();

const CategoryEntrySchema = z.strictObject({
  model: z.string().min(1),
  reasoning: z.enum(['off', 'on', 'auto']).optional(),
});

/** `.jamcli/config.json`, `.jamcli/config.local.json`, and the user's `config.json`. */
export const ConfigFileSchema = z
  .strictObject({
    $schema: z.string().describe('The JSON schema this file follows, for editors.'),
    model: z.string().min(1).describe('The model sessions start on, as "provider:model" or a model on the profile\'s provider.'),
    active_profile: z.string().min(1).describe('The profile in profiles/<name>.json to use.'),
    api_registry: ApiRegistrySchema,
    models: z.record(z.string(), ModelSettingsSchema).describe('Facts about models, keyed "provider:model", overriding what providers report.'),
    permissions: PermissionSettingsSchema,
    sandbox: SandboxSettingsSchema,
    agent_loop: AgentLoopSchema,
    context: z
      .strictObject({
        auto_compact: z.boolean().describe('Summarize older turns when a request nears the model\'s window. On by default.'),
      })
      .partial(),
    categories: z.record(z.string(), z.array(CategoryEntrySchema)).describe('Model chains delegation routes each category of task to.'),
    delegation: z
      .strictObject({
        max_depth: positiveInt(),
        max_concurrent: positiveInt(),
        max_turns_per_child: positiveInt(),
      })
      .partial(),
    trust: z
      .strictObject({
        enabled: z.boolean(),
        model: z.string(),
        threshold: z.number().min(0).max(1),
        dedupe: z.boolean(),
      })
      .partial()
      .describe('The classifier that screens tool output before the model reads it.'),
    telemetry: z.boolean().describe('Off by default. Nothing leaves the machine unless configured.'),
    // Read by the legacy interface only.
    context_management: z
      .strictObject({
        enabled: z.boolean(),
        max_tokens: positiveInt(),
        compression_threshold: z.number().min(0).max(1),
        strategy: z.enum(['summarize', 'truncate']),
      })
      .partial()
      .describe('Context settings for the legacy interface. Sessions use context instead.'),
    general: z.strictObject({ show_tool_calling_models_only: z.boolean() }).partial(),
    available_models: z.array(
      z.strictObject({
        id: z.string(),
        provider: z.enum(['ollama', 'openai', 'anthropic', 'openrouter']),
        name: z.string(),
        description: z.string().optional(),
        supports_tool_calling: z.boolean().optional(),
      })
    ),
  })
  .partial();

/** `profiles/<name>.json`, in the user or the project configuration directory. */
export const ProfileSchema = z
  .strictObject({
    name: z.string(),
    system_prompt_override: z.string().describe('Replaces JamCLI\'s own opening instructions.'),
    preferred_model: z.string(),
    preferred_provider: z.string(),
    temperature: z.number().min(0).max(2),
  })
  .partial();

const McpServerSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    env_passthrough: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    transport: z.enum(['stdio', 'sse', 'http']).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
  })
  .loose();

const ToolPermissionSchema = z.union([
  z.boolean(),
  z.object({ allowed: z.boolean(), require_approval: z.boolean().optional(), description: z.string().optional() }).loose(),
]);

/** The legacy `.jamcli/mcp.json`: MCP servers, and the per-tool block `jamcli config migrate` turns into rules. */
export const McpFileSchema = z
  .object({
    servers: z.array(McpServerSchema),
    tools: z.record(z.string(), ToolPermissionSchema),
    context_window_limit: positiveInt(),
    ignore_patterns: z.array(z.string()),
  })
  .partial()
  .loose();

export type ConfigFile = z.infer<typeof ConfigFileSchema>;
export type ProfileFile = z.infer<typeof ProfileSchema>;
export type McpFile = z.infer<typeof McpFileSchema>;

/** The JSON schema editors complete `config.json` files against. */
export function configJsonSchema(): Record<string, unknown> {
  return { ...z.toJSONSchema(ConfigFileSchema, { io: 'input' }), title: 'JamCLI configuration' };
}
