export const ENTER_PLANNING_MODE =
  'Switch into planning mode. Use this when a task is complex enough to need a ' +
  'multi-step plan, such as changes across several files, architectural decisions, ' +
  'or unclear requirements. Do not use it for small, well-defined edits. ' +
  'While in planning mode you can read, search, and list files and draft plans, ' +
  'but you cannot edit or create files. ';

export const EXIT_PLANNING_MODE =
  'Leave planning mode and begin executing the approved plan. ' +
  'Only call this after you have presented a plan with draft_plan and the user ' +
  'has explicitly approved it. If the user requests changes, revise the plan ' +
  'and present it again instead of exiting. After exiting, you can use edit_file ' +
  'and create_file to carry out the plan. ';

export const DRAFT_PLAN =
  'Present a step-by-step plan to the user for review. After calling this, ' +
  'stop and ask for feedback. Do not start implementing. ';