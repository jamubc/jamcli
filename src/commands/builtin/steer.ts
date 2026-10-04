import { loadConfig } from '../../core/config/load.js';
import { runConfigCommand } from '../../cli/config.js';
import type { SlashCommand } from '../types.js';
import { reopen } from './index.js';

export const steer: SlashCommand = {
  name: 'steer',
  args: '[instruction]',
  summary: 'Queue a steering instruction for the model to execute tools and keep going',
  source: 'built-in',
  run(ctx, args) {
    if (!args?.trim()) {
      return ctx.show('Usage: /steer <instruction>. Injects steering guidance for the model to execute tools and keep going.');
    }
    ctx.runtime.steer(args.trim());
    ctx.notice('info', 'Steering instruction queued for next model interaction.');
  },
};

export const goal: SlashCommand = {
  name: 'goal',
  args: '[<text>|clear]',
  summary: 'Set or inspect a standing goal that persists across turns, or clear it',
  source: 'built-in',
  run(ctx, args) {
    const trimmed = args?.trim();
    if (trimmed?.toLowerCase() === 'clear') {
      ctx.runtime.setGoal(undefined);
      return ctx.notice('info', 'Standing goal cleared.');
    }
    if (!trimmed) {
      const current = ctx.runtime.getGoal();
      if (current) return ctx.show(`Standing goal: ${current}\n\nUse /goal clear to remove it, or /goal <text> to replace it.`);
      return ctx.show('No standing goal set. Use /goal <text> to set one, or /goal clear to remove it.');
    }
    ctx.runtime.setGoal(trimmed);
    ctx.notice('info', `Standing goal set: ${trimmed}`);
  },
};

export const agentic: SlashCommand = {
  name: 'agentic',
  args: '[on|off|status]',
  summary: 'Configure agentic tool use enforcement, execution guidance, stall guards, and loop guardrails',
  source: 'built-in',
  async run(ctx, args) {
    const action = args?.trim().toLowerCase();
    if (action === 'on') {
      const io = { out: () => undefined, err: (err: string) => ctx.notice('error', err) };
      const code = await runConfigCommand({ action: 'set', args: ['agent_loop.tool_use_enforcement', 'on'] }, ctx.projectRoot, io);
      await runConfigCommand({ action: 'set', args: ['agent_loop.execution_guidance', 'on'] }, ctx.projectRoot, io);
      await runConfigCommand({ action: 'set', args: ['agent_loop.intent_ack_continuation', 'on'] }, ctx.projectRoot, io);
      await runConfigCommand({ action: 'set', args: ['agent_loop.stall_guards', 'true'] }, ctx.projectRoot, io);
      await runConfigCommand({ action: 'set', args: ['agent_loop.tool_loop_guardrails', 'true'] }, ctx.projectRoot, io);
      if (code === 0) {
        ctx.notice('info', 'Agentic mode enabled: tool use enforcement, execution guidance, intent continuation, stall guards, and loop guardrails are ON.');
        if (ctx.runtime.permissionMode !== 'auto' && ctx.runtime.permissionMode !== 'bypass') {
          ctx.notice('info', `Tip: You are currently in ${ctx.runtime.permissionMode} permission mode. Run /mode auto if stops for tool permissions feel like stalls.`);
        }
        await reopen(ctx);
      }
      return;
    }
    if (action === 'off') {
      const io = { out: () => undefined, err: (err: string) => ctx.notice('error', err) };
      await runConfigCommand({ action: 'set', args: ['agent_loop.tool_use_enforcement', 'off'] }, ctx.projectRoot, io);
      await runConfigCommand({ action: 'set', args: ['agent_loop.execution_guidance', 'off'] }, ctx.projectRoot, io);
      await runConfigCommand({ action: 'set', args: ['agent_loop.intent_ack_continuation', 'off'] }, ctx.projectRoot, io);
      await runConfigCommand({ action: 'set', args: ['agent_loop.stall_guards', 'false'] }, ctx.projectRoot, io);
      await runConfigCommand({ action: 'set', args: ['agent_loop.tool_loop_guardrails', 'false'] }, ctx.projectRoot, io);
      ctx.notice('info', 'Agentic mode disabled: tool use enforcement and corrective layers are OFF.');
      await reopen(ctx);
      return;
    }
    const currentLoop = loadConfig({ projectRoot: ctx.projectRoot }).config.agent_loop;
    const enforcement = currentLoop?.tool_use_enforcement ?? 'auto';
    const guidance = currentLoop?.execution_guidance ?? 'auto';
    const continuation = currentLoop?.intent_ack_continuation ?? 'auto';
    const guards = currentLoop?.stall_guards ?? true;
    const guardrails = currentLoop?.tool_loop_guardrails ?? true;
    const lines = [
      'Agentic stack status:',
      `- Tool use enforcement: ${enforcement} (prepends prompt block to eliminate narration)`,
      `- Execution guidance: ${guidance} (persistence, arithmetic tools, verification read-backs)`,
      `- Intent ack continuation: ${continuation} (nudges model when reply describes intent without calls)`,
      `- Stall guards: ${guards ? 'on' : 'off'} (catches trailing plans, dropped calls, identical call loops)`,
      `- Tool loop guardrails: ${guardrails ? 'on' : 'off'} (bounds repeating loops)`,
      `- Current permission mode: ${ctx.runtime.permissionMode}`,
      '',
      'Commands:',
      '- /agentic on: activate all agentic steering and corrective layers',
      '- /agentic off: turn off agentic layers',
      '- /steer <instruction>: nudge the model during or across turns',
      '- /goal [<text>|clear]: maintain or clear a standing goal across turns',
    ];
    ctx.show(lines.join('\n'));
  },
};
