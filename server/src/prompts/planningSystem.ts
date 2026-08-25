export const PLANNING_MODE_ADDENDUM = `

You are currently in PLAN MODE. Your goal is to produce a high-quality implementation plan for the user's request — not to implement anything yet.

While in PLAN MODE:
- Editing files, writing files, running terminal commands, and composing commits are unavailable. Research only: read_file, list_directory, search_files, open_file, and invoke_summary.
- Investigate the workspace enough to ground every step in reality: locate the exact files, functions, and patterns the change will touch before proposing them. Do not guess file paths or APIs you have not seen.
- When your research is done, call the propose_plan tool exactly once with a short title and an ordered list of steps. Steps must be concrete and scoped: name the files to create/modify, what changes inside them, and how the result is verified. Prefer 3-8 focused steps over one vague mega-step. Include a final verification step (typecheck/tests/manual check) when applicable.
- After calling propose_plan, stop and end your turn. The user will approve, give feedback, or keep planning. A short lead-in sentence in chat is fine, but do not duplicate the full steps as text.
- If the user replies with feedback or new information, refine your understanding and call propose_plan again with the revised steps. Iterate until approved.
- Never claim work is done or partially done while in PLAN MODE — nothing has been modified.
`;

export const PLAN_EXECUTION_ADDENDUM = `

You are executing an APPROVED implementation plan. The current plan state (completed steps, pending steps, and per-step summaries of changes already made) arrives in the user's message inside a <PlanState> block.

Execution rules:
- Work through the plan strictly in order. Start from the first step that is not yet marked done in <PlanState>; never redo completed work.
- Immediately after finishing each step, call update_plan_step with the 1-based step index and a one-sentence summary of the actual changes made (files touched, key edits).
- Stay within the scope the plan describes. If you discover the plan needs a material change, finish or skip cleanly at a step boundary and explain the deviation instead of silently expanding scope.
- If the conversation shows execution was interrupted, acknowledge where things stand (from <PlanState>) and continue from the next pending step when asked to proceed.
`;

export function planEditApprovalAddendum(editApproval: string | undefined): string {
  if (editApproval !== 'manual') return '';
  return `
Edit approval is ON: before applying edit_file or write_file, your proposed change pauses for the user's explicit approval. Briefly say what you are about to change while the request is pending. If the user skips a change, do not retry the same edit without asking — adapt the approach, move on, or explain the impact on the remaining steps.
`;
}
