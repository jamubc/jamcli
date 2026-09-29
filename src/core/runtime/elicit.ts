import type { ElicitationAnswer, ElicitationRequest } from '../mcp/connect.js';
import type { AgentEvent } from '../types.js';

/**
 * Requests for input from an MCP server, or from `ask_user`, put to the person through the
 * interface while a turn runs there. Other surfaces, and requests outside a turn, are
 * declined with a notice. Requests still waiting when the turn is stopped are cancelled.
 */
export class Elicitations {
  private count = 0;
  private readonly waiting = new Set<(answer: ElicitationAnswer) => void>();

  constructor(
    private readonly options: {
      /** Whether this surface can put a question to the person: only the interface can. */
      canAsk: boolean;
      /** The running turn's emitter, or nothing between turns. */
      emit: () => ((event: AgentEvent) => void) | undefined;
    }
  ) {}

  readonly ask = (request: ElicitationRequest): Promise<ElicitationAnswer> =>
    new Promise((resolve) => {
      const emit = this.options.emit();
      if (!emit || !this.options.canAsk) {
        emit?.({ type: 'notice', level: 'warn', message: `MCP server ${request.server} asked for input ("${request.message}"), which this surface cannot give, so it was declined.` });
        return resolve({ action: 'decline' });
      }
      let answered = false;
      const respond = (answer: ElicitationAnswer) => {
        if (answered) return;
        answered = true;
        this.waiting.delete(respond);
        resolve(answer);
      };
      this.waiting.add(respond);
      emit({ type: 'elicitation_request', id: `elicit-${++this.count}`, request, respond });
    });

  /** The turn was stopped: every request still waiting is answered "cancel". */
  cancelAll(): void {
    for (const respond of [...this.waiting]) respond({ action: 'cancel' });
  }
}
