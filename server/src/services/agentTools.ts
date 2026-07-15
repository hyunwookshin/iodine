import { randomUUID } from 'crypto';
import { Response } from 'express';
import { executeTool } from './fileTools';
import { requestTerminalApproval, runTerminalCommand } from './terminalCommands';

export async function executeAgentTool(
  name: string,
  input: Record<string, unknown>,
  res: Response,
  abortSignal: { aborted: boolean },
) {
  if (name !== 'run_terminal_command') return executeTool(name, input);

  const command = typeof input.command === 'string' ? input.command.trim() : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const longRunning = input.longRunning === true;

  if (!command || !reason) {
    return {
      content: 'command and reason are required',
      preview: 'command and reason are required',
      error: true,
    };
  }

  const id = randomUUID();
  const approved = await requestTerminalApproval({ id, command, reason, longRunning }, res, abortSignal);
  if (!approved) {
    return {
      content: 'The user rejected or did not respond to the terminal command request. Do not run it. Explain what could not be completed or propose a safe alternative.',
      preview: 'Command rejected by user',
      error: true,
    };
  }

  return runTerminalCommand({ id, command, reason, longRunning }, (stream, data) => {
    if (!abortSignal.aborted) {
      res.write(`event: command_output\ndata: ${JSON.stringify({ id, stream, data })}\n\n`);
    }
  });
}
