import { createExecutionPresentation, type ExecutionPresentationMode } from '../shared/execution-presentation.js';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';
import { createCoreOrchestrationJobActivity, type CoreOrchestrationTeamsActivity } from './genui-response.js';
import { withTeamsJobDeepLink } from './teams-tab-link.js';

export type PresentedCoreActivity = CoreOrchestrationTeamsActivity | Readonly<{ type: 'message'; text: string }>;

export function createExecutionPresentationActivity(job: CoreOrchestrationJob, mode: ExecutionPresentationMode,
  options: { openTabUrl?: string; richEnabled: boolean }): PresentedCoreActivity {
  if (mode === 'summary') return createCoreOrchestrationJobActivity(job, options);
  const presentation = createExecutionPresentation(job);
  if (mode === 'text') return { type: 'message', text: presentation.text };
  const link = options.richEnabled ? withTeamsJobDeepLink(options.openTabUrl, job.id) : undefined;
  if (!link) return { type: 'message', text: `${presentation.text}\n\nCopilotKit 화면을 현재 사용할 수 없습니다.` };
  return {
    type: 'message', attachmentLayout: 'list', attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive', content: {
        type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.6',
        msteams: { width: 'Full' }, body: [
          { type: 'TextBlock', text: '업무 허브 · CopilotKit 보기', weight: 'Bolder', wrap: true },
          { type: 'TextBlock', text: presentation.summary, wrap: true },
          { type: 'FactSet', facts: [{ title: '작업 ID', value: presentation.jobId }] },
        ], actions: [{ type: 'Action.OpenUrl', title: '같은 작업의 CopilotKit 화면 열기', url: link }],
      },
    }],
  };
}
