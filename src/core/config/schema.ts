import { z } from 'zod';
import { PERMISSION_MODES, type PermissionMode } from '../permissions/modes.js';
import { THINKING_CHOICES } from '../routing/capabilities.js';
import type { USER_HOOK_EVENTS } from '../hooks/commands.js';

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

/** When each hook event's commands run, for every event a person can hook. */
const HOOK_EVENT_WORDS: Record<(typeof USER_HOOK_EVENTS)[number], string> = {
  session_start: 'when a session opens, new or resumed',
  user_prompt_submit: 'before a prompt is recorded or sent; one may stop it or add context to it',
  pre_tool: 'before a tool call is decided; one may deny, ask, allow, or change its arguments',
  post_tool: 'after a tool call has run, with its result',
  stop: 'when the model answers with no calls; one may ask it to carry on',
  pre_compact: 'before older messages are summarized; one may add to what the summary keeps',
  notification: "when the person's attention is wanted, such as for an approval",
  session_end: 'when a session ends',
};

/** Said of a key only the legacy configuration service normalizes. */
const LEGACY = 'Kept so older configuration files still load. Sessions do not read it.';

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
        base_url: z.string().describe('Where Ollama listens, used in place of endpoint when both are set.'),
        num_ctx: positiveInt().describe('The context window Ollama allocates for every request.'),
      })
      .partial(),
    openai: z.strictObject(keyed).partial(),
    anthropic: z.strictObject(keyed).partial(),
    typesafe: z
      .strictObject(keyed)
      .partial()
      .describe('TypeSafe, whose Jev model the trust gate used. Read by nothing since the gate was removed on 2026-09-29; still accepted so existing files load.'),
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
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().describe('How hard the model thinks, where it takes a level.'),
});

/** `.jamcli/config.json`, `.jamcli/config.local.json`, and the user's `config.json`. */
export const ConfigFileSchema = z
  .strictObject({
    $schema: z.string().describe('The JSON schema this file follows, for editors.'),
    model: z.string().min(1).describe('The model sessions start on, as "provider:model" or a model on the profile\'s provider.'),
    active_profile: z.string().min(1).describe('The profile in profiles/<name>.json to use.'),
    effort: z
      .enum(THINKING_CHOICES)
      .describe("How sessions think: off, auto (the model's default), on, or an effort level from low to max. /effort sets it."),
    api_registry: ApiRegistrySchema,
    models: z.record(z.string(), ModelSettingsSchema).describe('Facts about models, keyed "provider:model", overriding what providers report.'),
    permissions: PermissionSettingsSchema,
    sandbox: SandboxSettingsSchema,
    agent_loop: AgentLoopSchema,
    lsp: z
      .strictObject({
        enabled: z.boolean().describe('The lsp tool and diagnostics after edits. On by default, for the servers that are installed.'),
        diagnostics_after_edit: z.boolean().describe('Tell the model about errors the language server finds in a file it just changed. On by default.'),
        servers: z
          .record(
            z.string(),
            z.strictObject({
              command: z.string().min(1),
              args: z.array(z.string()).optional(),
              extensions: z.array(z.string().min(1)).describe('File extensions it serves, without the dot.'),
              enabled: z.boolean().optional(),
            })
          )
          .describe('Language servers by name. A name used by a default (typescript, python, go, rust) replaces it.'),
      })
      .partial(),
    search: z
      .strictObject({
        providers: z
          .record(
            z.string(),
            z.strictObject({
              endpoint: z.string().url().optional().describe('The provider API endpoint. The built-in LangSearch endpoint is used when omitted.'),
              api_key: z.string().optional().describe('The key itself. Used only when the declared variable is not set.'),
              key_env_var: z.string().optional().describe('The environment variable holding the key. Read first.'),
            })
          )
          .describe('Search providers by name. A name used by a built-in (langsearch) replaces it.'),
      })
      .partial(),
    tool_search: z
      .strictObject({
        threshold: nonNegativeInt().describe('Offer MCP tools through search_tools once the servers bring more than this many. 0 always sends them all. Defaults to 40.'),
      })
      .partial(),
    context: z
      .strictObject({
        auto_compact: z.boolean().describe('Summarize older turns when a request nears the model\'s window. On by default.'),
      })
      .partial(),
    categories: z
      .record(z.string(), z.array(CategoryEntrySchema))
      .describe('Model chains by name, loaded as agents with no description or rules. Agent files in .jamcli/agents/ describe them.'),
    delegation: z
      .strictObject({
        max_depth: positiveInt().describe('How deep tasks may nest: a task started by a task counts one deeper. Defaults to 2.'),
        max_concurrent: positiveInt().describe('Tasks one session may run at once. Defaults to 5.'),
        max_turns_per_child: positiveInt().describe('Turns a task may take; a task call may ask for fewer, never more. Defaults to 16.'),
        default_agent: z.string().min(1).describe('The agent a task call that names none runs on.'),
      })
      .partial(),
    trust: z
      .strictObject({
        enabled: z.boolean().describe('Read by nothing since the trust gate was removed on 2026-09-29.'),
        model: z.string().describe('Read by nothing since the trust gate was removed on 2026-09-29; a session that finds it set says so once.'),
        threshold: z.number().min(0).max(1).describe('Read by nothing since the trust gate was removed on 2026-09-29.'),
        dedupe: z.boolean().describe('Read by nothing since the trust gate was removed on 2026-09-29.'),
      })
      .partial()
      .describe('The trust gate\'s settings, still accepted so existing files load. The gate was removed on 2026-09-29: the sandbox and the network rules hold auto mode.'),
    telemetry: z.boolean().describe('The legacy interface\'s telemetry switch. Traces are sent only when otel.enabled is true.'),
    otel: z
      .strictObject({
        enabled: z.boolean().describe('Send traces to an OpenTelemetry collector. Off by default: nothing leaves the machine unless this is true.'),
        endpoint: z.string().describe('The OTLP/HTTP traces URL. Defaults to OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, OTEL_EXPORTER_OTLP_ENDPOINT, then http://localhost:4318/v1/traces.'),
        headers: z.record(z.string(), z.string()).describe('Headers sent with every export, such as a collector token.'),
        include_content: z.boolean().describe('Put prompts, outputs, tool arguments, and tool results on spans. Off by default.'),
      })
      .partial(),
    hooks: z
      .strictObject(
        Object.fromEntries(
          Object.entries(HOOK_EVENT_WORDS).map(([event, when]) => [
            event,
            z.array(
              z.strictObject({
                matcher: z.string().optional().describe('For pre_tool and post_tool: a rule such as run_command(git push*) or edit. Every call when absent.'),
                command: z.string().min(1).describe('Run with /bin/sh (cmd.exe on Windows), reading the event as JSON on standard input.'),
                timeout_ms: positiveInt().optional().describe('Stop it and report a failure after this long. Defaults to 30000.'),
                enabled: z.boolean().optional().describe('false keeps it here without running it.'),
              })
            ).describe(`Commands run ${when}.`),
          ])
        ) as Record<string, z.ZodArray<z.ZodObject<any>>>
      )
      .partial()
      .describe('Commands run at lifecycle events. Exit 0 continues, exit 2 blocks with standard error as the reason. A project\'s hooks run only once trusted.'),
    git: z
      .strictObject({
        attribution: z.string().describe('A trailer added to every commit JamCLI makes, such as "Co-authored-by: ...". Off by default: commits carry only your own identity.'),
        allow_commit_in_bypass: z.boolean().describe('Let bypass mode commit without asking. Off by default: a commit is always asked for, whatever the mode.'),
      })
      .partial()
      .describe('How JamCLI commits.'),
    ui: z
      .strictObject({
        theme: z.enum(['dark', 'light', 'high-contrast', 'monochrome']).describe('The interface\'s colors. NO_COLOR forces monochrome. Defaults to dark.'),
        screen_reader: z.boolean().describe('Draw the interface as plain labeled lines, with no boxes, marks, or animation. --screen-reader turns it on for one run.'),
        reduced_motion: z.boolean().describe('Stop the spinner and shimmer. On by itself in screen reader mode.'),
        thinking_lines: z.number().int().min(1).max(40).describe('How many lines tall the live thinking window is. It keeps that height while the model thinks, so the transcript does not jump. Defaults to 3.'),
        thinking_width: z.number().int().min(20).max(400).describe('How many columns wide the live thinking window is, narrowed when the terminal is narrower. Defaults to 72.'),
        status_text_style: z
          .string()
          .regex(/^(glow|mono|aurora|rainbow|minimal|whimsy|subtle|custom:[\w.-]+)$/, 'a built-in text style (glow, mono, aurora, rainbow, minimal, whimsy) or custom:<name>')
          .describe('How the working indicator\'s words are lit, and for whimsy which words it shows: glow, mono, aurora, rainbow, minimal, whimsy, or custom:<name>. Defaults to glow.'),
        status_spinner_style: z
          .string()
          .regex(/^(pulse|bloom|orbit|quad|classic|big_classic|big_orbit|big_pulse|custom:[\w.-]+)$/, 'a built-in spinner (pulse, bloom, orbit, quad, classic) or custom:<name>')
          .describe('The working indicator\'s spinner: pulse, bloom, orbit, quad, classic, or custom:<name>. Defaults to pulse.'),
        custom_status_styles: z
          .record(z.string(), z.strictObject({ path: z.string().describe('A JSON file with label, shimmerColors (the words\' ramp from resting to lit), shimmer, spinnerFrames, spinnerColors (the ramp the spinner breathes through), spinnerIntervalMs, and words (lists of words for thinking, streaming, and tool, one shown each time the phase begins). A color is hex, or a theme role: text, dim, accent, warn, or error.'), label: z.string().optional() }))
          .describe('Styles of your own, by name, each read from a JSON file. Name one as custom:<name>.'),
      })
      .partial()
      .describe('How the interface looks and moves.'),
    // Read by the legacy interface only.
    context_management: z
      .strictObject({
        enabled: z.boolean().describe(LEGACY),
        max_tokens: positiveInt().describe(LEGACY),
        compression_threshold: z.number().min(0).max(1).describe(LEGACY),
        strategy: z.enum(['summarize', 'truncate']).describe(LEGACY),
      })
      .partial()
      .describe('Context settings for the legacy interface. Sessions use context instead.'),
    general: z.strictObject({ show_tool_calling_models_only: z.boolean().describe(LEGACY) }).partial(),
    available_models: z.array(
      z.strictObject({
        id: z.string(),
        provider: z.enum(['ollama', 'openai', 'anthropic', 'openrouter']),
        name: z.string(),
        description: z.string().optional(),
        supports_tool_calling: z.boolean().optional(),
      })
    ).describe(LEGACY),
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
