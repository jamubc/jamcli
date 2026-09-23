import { HistoryService } from '../../services/HistoryService.js';
import type { SessionMetadata } from '../../services/HistoryService.js';
import { resolveJamcliProjectRoot } from '../../utils/projectRoot.js';

export const listSessions = async (projectRoot: string, limit = 20): Promise<SessionMetadata[]> => {
  const history = new HistoryService(projectRoot);
  await history.initialize();
  const sessions = await history.listSessions(Math.max(limit, 50));
  return sessions.slice(0, limit);
};

export const latestSessionId = async (projectRoot: string): Promise<string | null> => {
  const [latest] = await listSessions(projectRoot, 1);
  return latest?.id ?? null;
};

export const searchSessions = async (
  projectRoot: string,
  query: string,
  limit = 20
): Promise<SessionMetadata[]> => {
  const history = new HistoryService(projectRoot);
  await history.initialize();
  const results = await history.searchSessions(query);
  return results.slice(0, limit);
};

export const loadSessionMessages = async (
  projectRoot: string,
  sessionId: string
): Promise<{ id: string; role: string; content: string; timestamp: number }[]> => {
  const history = new HistoryService(projectRoot, sessionId);
  await history.initialize();
  const messages = await history.loadMessagesFromHistory();
  return messages.map((message: any) => ({
    id: '',
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }));
};

export const exportSession = async (projectRoot: string, sessionId: string): Promise<string> => {
  const history = new HistoryService(projectRoot, sessionId);
  await history.initialize();
  return history.saveMarkdownExport();
};

export const forkSession = async (projectRoot: string, sourceId: string): Promise<string | null> => {
  const source = await loadSessionMessages(projectRoot, sourceId);
  if (!source.length) return null;
  const target = new HistoryService(projectRoot);
  await target.initialize();
  const turns: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string; timestamp: number }[] = source.map(
    (message) => ({
      role: message.role as 'user' | 'assistant' | 'system' | 'tool',
      content: message.content,
      timestamp: message.timestamp,
    })
  );
  let index = 0;
  while (index < turns.length) {
    const first = turns[index];
    const second = turns[index + 1];
    if (second && first.role === 'user' && second.role === 'assistant') {
      await target.appendTurn(
        [
          { role: 'user', content: first.content, timestamp: first.timestamp },
          { role: 'assistant', content: second.content, timestamp: second.timestamp },
        ],
        undefined
      );
      index += 2;
      continue;
    }
    await target.appendTurn([{ role: first.role, content: first.content, timestamp: first.timestamp }], undefined);
    index += 1;
  }
  return target.getSessionId();
};

export const projectRootFor = (cwd?: string): string => {
  if (cwd) process.chdir(cwd);
  return resolveJamcliProjectRoot();
};
