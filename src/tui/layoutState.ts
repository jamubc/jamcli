import type { SlashCommand } from './InputBar.js';
import type { ModelInfo } from '../types/config.js';
import type { SessionMetadata } from '../services/HistoryService.js';
import type { McpServerConfig } from '../types/mcp.js';
import type { McpServerForm } from './McpServerModal.js';
import type { Profile } from '../types/config.js';
import type { Message } from '../core/types.js';
import type { LLMFactory } from '../services/LLMProvider.js';

export const resetTerminalViewport = () => {
  if (!process.stdout) return;
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
};

export const BRACKETED_PASTE_START = '\x1b[200~';
export const BRACKETED_PASTE_END = '\x1b[201~';

export const normalizePastedContent = (value: string) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/model', description: 'Switch AI model' },
  { name: '/copy', description: 'Copy chat (/copy o 3)' },
  { name: '/profile', description: 'Switch profile' },
  { name: '/resume', description: 'Resume previous session' },
  { name: '/tools', description: 'Manage AI tool permissions' },
  { name: '/mcp', description: 'Manage MCP servers and tools' },
  { name: '/config', description: 'Open configuration menu' },
  { name: '/categories', description: 'Show model categories' },
  { name: '/compact', description: 'Compress conversation history' },
  { name: '/clear', description: 'Clear chat history' },
  { name: '/help', description: 'Show help' },
  { name: '/exit', description: 'Exit JamCLI' },
];

export const CONFIG_SUBCOMMANDS: SlashCommand[] = [
  { name: 'provider', description: 'Configure AI providers (ollama, openrouter)' },
  { name: 'prompt', description: 'View or edit system prompt' },
  { name: 'style', description: 'Status indicator style' },
];

export type ModelMenuState = {
  open: boolean;
  models: ModelInfo[];
  selectedIndex: number;
  searchQuery: string;
};

export type SessionMenuState = {
  open: boolean;
  sessions: SessionMetadata[];
  allSessions: SessionMetadata[];
  selectedIndex: number;
  searchQuery: string;
  currentPage: number;
};

export const initialModelMenuState: ModelMenuState = {
  open: false,
  models: [],
  selectedIndex: 0,
  searchQuery: '',
};

export const initialSessionMenuState: SessionMenuState = {
  open: false,
  sessions: [],
  allSessions: [],
  selectedIndex: 0,
  searchQuery: '',
  currentPage: 0,
};

export const CONFIGURE_ENTRY_ID = '__configure__';
export const CONFIGURE_MODELS_ENTRY: ModelInfo = {
  id: CONFIGURE_ENTRY_ID,
  provider: 'openrouter',
  name: 'Configure models & providers',
  description: 'Add providers, API keys, and custom model entries.',
};

export const SESSION_PAGE_SIZE = 8;

export type ProviderSlug = 'ollama' | 'openrouter';

export type ConfigWizardState =
  | null
  | {
      mode: 'provider';
      provider: ProviderSlug;
      form: Record<string, string>;
    }
  | {
      mode: 'mcp';
      action: 'add' | 'edit';
      server?: McpServerConfig;
      form: McpServerForm;
    };

export const TOOL_COMMAND_USAGE = 'Usage: /tools [status|enable|disable|require|auto] <tool_name>';
export const MCP_COMMAND_USAGE = 'Usage: /mcp [servers|tools|add|remove]';
export const PROVIDER_COMMAND_USAGE = 'Usage: /config provider [list|set] [ollama|openrouter] [value]';

export const THINKING_STATUS_LINES = [
  'Deciding on build steps to catch errors',
  'Scanning recent turns for context',
  'Choosing which tools to call next',
  'Lining up a plan before replying',
];

export const STREAMING_STATUS_LINES = [
  'Shaping the reply',
  'Tightening wording and code blocks',
  'Streaming the answer',
  'Wrapping up the response',
];

export type AgentLoopState = {
  messages: Message[];
  provider: ReturnType<typeof LLMFactory.createProvider>;
  profile: Profile | null;
  providerKey: 'ollama' | 'openrouter';
  step: number;
  maxSteps: number;
};

export type StatusDetail = {
  phase: 'thinking' | 'streaming';
  modelName?: string;
  startedAt: number;
  message: string;
};

export type CollapsedPastePreview = {
  id: number;
  content: string;
  lineCount: number;
  charCount: number;
};
