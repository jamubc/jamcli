import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Message, TokenUsage } from '../store/index.js';
import { jamcliPaths, getStateDir } from '../utils/paths.js';

export interface SessionMetadata {
  id: string;
  projectRoot: string;
  projectName: string;
  created: string;
  updated: string;
  totalTokens: number;
  messageCount: number;
  model?: string;
  title?: string;
  firstUserMessage?: string;
}

export interface ConversationTurn {
  id: string;
  timestamp: string;
  model?: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  usage?: TokenUsage;
}

export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

export class HistoryService {
  private projectRoot: string;
  private sessionId: string;
  private sessionUsage: SessionUsage;
  private historyDir: string;
  private globalStateDir: string;
  private disabled: boolean;

  constructor(projectRoot: string = process.cwd(), sessionId?: string) {
    this.projectRoot = projectRoot;
    this.sessionId = sessionId || this.generateSessionId();
    this.sessionUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
    };
    this.disabled = false;
    
    // Project-local history directory
    this.historyDir = path.join(jamcliPaths.projectLocal(projectRoot), 'history');
    
    // Global state directory
    this.globalStateDir = getStateDir();
  }

  private generateSessionId(): string {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const uuid = uuidv4().split('-')[0];
    return `${dateStr}-${uuid}`;
  }

  async initialize(): Promise<void> {
    try {
      await fs.ensureDir(this.historyDir);
      await fs.ensureDir(this.globalStateDir);
      await this.updateSessionMetadata();
    } catch (error) {
      this.disabled = true;
      console.error('History disabled (unable to initialize):', error);
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionUsage(): SessionUsage {
    return { ...this.sessionUsage };
  }

  updateUsage(usage?: TokenUsage): void {
    if (this.disabled) return;
    if (!usage) return;
    
    this.sessionUsage.promptTokens += usage.prompt_tokens || 0;
    this.sessionUsage.completionTokens += usage.completion_tokens || 0;
    this.sessionUsage.totalTokens += usage.total_tokens || 0;
    this.sessionUsage.callCount += 1;
  }

  async appendTurn(messages: Message[], usage?: TokenUsage): Promise<void> {
    if (this.disabled) return;
    const turn: ConversationTurn = {
      id: `turn-${Date.now()}`,
      timestamp: new Date().toISOString(),
      model: messages.find(m => m.model)?.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      usage,
    };

    // Update usage tracking
    this.updateUsage(usage);

    // Append to JSONL history file
    const historyFile = path.join(this.historyDir, `${this.sessionId}.jsonl`);
    const line = JSON.stringify(turn) + '\n';
    try {
      await fs.appendFile(historyFile, line, 'utf-8');
      await this.updateSessionMetadata();
    } catch (error) {
      this.disabled = true;
      console.error('History disabled (failed to append turn):', error);
    }
  }

  async loadHistory(): Promise<ConversationTurn[]> {
    if (this.disabled) return [];
    const historyFile = path.join(this.historyDir, `${this.sessionId}.jsonl`);
    
    if (!(await fs.pathExists(historyFile))) {
      return [];
    }

    try {
      const content = await fs.readFile(historyFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim() !== '');
      
      return lines.map(line => JSON.parse(line) as ConversationTurn);
    } catch (error) {
      console.error(`Error loading history for session ${this.sessionId}:`, error);
      return [];
    }
  }

  async loadMessagesFromHistory(maxMessages?: number): Promise<Message[]> {
    const turns = await this.loadHistory();
    const messages: Message[] = [];
    
    for (const turn of turns) {
      for (const msg of turn.messages) {
        messages.push({
          role: msg.role,
          content: msg.content,
          timestamp: new Date(turn.timestamp).getTime(),
          model: turn.model,
          usage: turn.usage,
        });
      }
    }

    // Return last N messages if specified
    if (maxMessages && messages.length > maxMessages) {
      return messages.slice(-maxMessages);
    }

    return messages;
  }

  private async updateSessionMetadata(): Promise<void> {
    if (this.disabled) return;
    const turns = await this.loadHistory();
    
    // Extract first user message for title generation
    let firstUserMessage = '';
    let title = '';
    
    if (turns.length > 0) {
      const firstTurn = turns[0];
      const userMsg = firstTurn.messages.find(m => m.role === 'user');
      if (userMsg) {
        firstUserMessage = userMsg.content;
        // Generate smart title from first message
        title = this.generateTitle(userMsg.content);
      }
    }

    const metadata: SessionMetadata = {
      id: this.sessionId,
      projectRoot: this.projectRoot,
      projectName: path.basename(this.projectRoot),
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      totalTokens: this.sessionUsage.totalTokens,
      messageCount: this.sessionUsage.callCount,
      title,
      firstUserMessage: firstUserMessage.substring(0, 200), // Store first 200 chars
    };

    // Append to global sessions JSONL
    const sessionsFile = path.join(this.globalStateDir, 'sessions.jsonl');
    
    // Check if session already exists in file
    let existingLines: string[] = [];
    if (await fs.pathExists(sessionsFile)) {
      const content = await fs.readFile(sessionsFile, 'utf-8');
      existingLines = content.split('\n').filter(line => line.trim() !== '');
    }

    // Remove old entry for this session if it exists
    const filteredLines = existingLines.filter(line => {
      try {
        const session = JSON.parse(line);
        return session.id !== this.sessionId;
      } catch {
        return false;
      }
    });

    // Add updated entry
    filteredLines.push(JSON.stringify(metadata));

    // Write back
    try {
      await fs.writeFile(sessionsFile, filteredLines.join('\n') + '\n', 'utf-8');
    } catch (error) {
      this.disabled = true;
      console.error('History disabled (failed to write metadata):', error);
    }
  }

  private generateTitle(firstMessage: string): string {
    // Remove common prefixes
    let cleaned = firstMessage
      .replace(/^(please|can you|could you|would you|help me|i need|i want to)\s+/i, '')
      .trim();
    
    // Take first sentence or first 50 characters
    const firstSentence = cleaned.split(/[.!?]\s/)[0];
    let title = firstSentence.length > 50 
      ? firstSentence.substring(0, 47) + '...'
      : firstSentence;
    
    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);
    
    // If still too generic, extract key words
    if (title.length < 10 || /^(how|what|why|when|where)/i.test(title)) {
      const words = cleaned.split(/\s+/).slice(0, 6);
      title = words.join(' ');
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }
    }
    
    return title || 'New conversation';
  }

  async listSessions(limit = 20): Promise<SessionMetadata[]> {
    const sessionsFile = path.join(this.globalStateDir, 'sessions.jsonl');
    
    if (!(await fs.pathExists(sessionsFile))) {
      return [];
    }

    const content = await fs.readFile(sessionsFile, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    
    const sessions = lines
      .map(line => {
        try {
          return JSON.parse(line) as SessionMetadata;
        } catch {
          return null;
        }
      })
      .filter((s): s is SessionMetadata => s !== null)
      .filter(s => s.messageCount > 0) // Only show sessions with messages
      .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

    return sessions.slice(0, limit);
  }

  async searchSessions(query: string, limit = 20): Promise<SessionMetadata[]> {
    const sessionsFile = path.join(this.globalStateDir, 'sessions.jsonl');
    
    if (!(await fs.pathExists(sessionsFile))) {
      return [];
    }

    const content = await fs.readFile(sessionsFile, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    
    const queryLower = query.toLowerCase();
    
    const sessions = lines
      .map(line => {
        try {
          return JSON.parse(line) as SessionMetadata;
        } catch {
          return null;
        }
      })
      .filter((s): s is SessionMetadata => s !== null)
      .filter(s => s.messageCount > 0) // Only show sessions with messages
      .filter(session => {
        // Search in title, first message, project name, and session ID
        const searchableText = [
          session.title || '',
          session.firstUserMessage || '',
          session.projectName,
          session.id,
        ].join(' ').toLowerCase();
        
        return searchableText.includes(queryLower);
      })
      .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

    return sessions.slice(0, limit);
  }

  async exportToMarkdown(): Promise<string> {
    const turns = await this.loadHistory();
    const lines: string[] = [];

    lines.push(`# Chat Session: ${this.sessionId}\n`);
    lines.push(`**Project:** ${path.basename(this.projectRoot)}`);
    lines.push(`**Total Tokens:** ${this.sessionUsage.totalTokens}`);
    lines.push(`**Messages:** ${this.sessionUsage.callCount}\n`);
    lines.push('---\n');

    for (const turn of turns) {
      for (const msg of turn.messages) {
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        lines.push(`## ${role}\n`);
        lines.push(msg.content);
        lines.push('\n');
      }

      if (turn.usage) {
        lines.push(`*Tokens: ${turn.usage.total_tokens} (prompt: ${turn.usage.prompt_tokens}, completion: ${turn.usage.completion_tokens})*\n`);
      }

      lines.push('---\n');
    }

    return lines.join('\n');
  }

  async saveMarkdownExport(): Promise<string> {
    const markdown = await this.exportToMarkdown();
    const exportPath = path.join(this.historyDir, `${this.sessionId}.md`);
    await fs.writeFile(exportPath, markdown, 'utf-8');
    return exportPath;
  }
}
