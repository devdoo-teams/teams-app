import { createExecutionPresentation, EXECUTION_PRESENTATION_DETAILS, type ExecutionPresentationMode, type ExecutionPresentationDetail } from '../shared/execution-presentation.js';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';
import { createCoreOrchestrationJobActivity, type CoreOrchestrationTeamsActivity } from './genui-response.js';
import { withTeamsCopilotJobDeepLink } from './teams-tab-link.js';

export type PresentedCoreActivity = CoreOrchestrationTeamsActivity | Readonly<{ type: 'message'; text: string }>;
const clip = (value: string, bytes = 600): string => {
  if (Buffer.byteLength(value) <= bytes) return value;
  let output = ''; for (const char of value) { if (Buffer.byteLength(output + char) > bytes - 16) break; output += char; }
  return output + ' …일부 생략';
};
const text = (value: string, bytes = 600) => ({ type: 'TextBlock', text: clip(value, bytes), wrap: true });

export function createExecutionPresentationActivity(job: CoreOrchestrationJob, mode: ExecutionPresentationMode,
  options: { openTabUrl?: string; richEnabled: boolean; details?: readonly ExecutionPresentationDetail[] }): PresentedCoreActivity {
  const presentation = createExecutionPresentation(job);
  const base = createCoreOrchestrationJobActivity(job, options);
  const baseCard = base.attachments?.[0]?.content as any;
  const link = options.richEnabled ? withTeamsCopilotJobDeepLink(options.openTabUrl, job.id) : undefined;
  if (mode === 'rich') {
    if (!link) return { type: 'message', text: `${presentation.statusLabel}\n${clip(presentation.result || presentation.summary, 2000)}${presentation.error ? `\n${clip(presentation.error, 1000)}` : ''}\n작업 ID: ${job.id}\nCopilotKit 대화를 현재 사용할 수 없습니다.` };
    return { type: 'message', attachmentLayout: 'list', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {
      type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.6', msteams: { width: 'Full' },
      body: [text('업무 허브 · 채팅 + 별도 상세'), text(presentation.statusLabel), text(presentation.result || presentation.summary, 2000),
        ...(presentation.error ? [text(presentation.error, 1000)] : []), text(`작업 ID: ${job.id}`)],
      actions: [{ type: 'Action.OpenUrl', title: '같은 작업의 대화·상세 열기', url: link },
        ...(baseCard?.actions ?? []).filter((action: {type:string}) => action.type !== 'Action.OpenUrl')],
    } }] };
  }
  const details = options.details ?? [...EXECUTION_PRESENTATION_DETAILS];
  const nested: any[] = [];
  if (details.includes('tool')) {
    nested.push(text('도구 결과'));
    if (!presentation.tools.length) nested.push(text('보고된 도구 없음'));
    for (const tool of presentation.tools) nested.push(text(`${tool.category} · ${tool.name}`, 180), text(tool.outcome || '종료 결과가 관측되지 않았습니다.', 300), text(tool.observedAt, 80));
  }
  if (details.includes('steps')) nested.push(text('진행 단계'), ...(presentation.progress.length ? presentation.progress.map(value => text(value, 180)) : [text('기록된 진행 단계가 없습니다.')]));
  if (details.includes('diagnostics')) {
    nested.push(text('진단 정보'));
    const facts = [...presentation.facts, ...presentation.receiptFacts].map(fact => ({title:clip(fact.label,90),value:clip(fact.value,160)}));
    for (let start=0;start<facts.length;start+=24) nested.push({type:'FactSet',facts:facts.slice(start,start+24)});
  }
  if (!details.length) nested.push(text('선택된 상세 항목이 없습니다.'));
  const actions = [{type:'Action.ShowCard',title:'선택한 상세 펼치기 / 접기',card:{type:'AdaptiveCard',version:'1.6',body:nested}}, ...(baseCard?.actions ?? [])];
  const card: any = {type:'AdaptiveCard',$schema:'http://adaptivecards.io/schemas/adaptive-card.json',version:'1.6',msteams:{width:'Full'},
    body:[text(mode==='text'?'업무 허브 · 채팅 중심':'Core 에이전트 작업 · 요약'),text(presentation.statusLabel),
      text(presentation.result || presentation.summary,2000),...(presentation.error?[text(presentation.error,1000)]:[]),
      {type:'FactSet',facts:[{title:'작업 ID',value:job.id},{title:'상태',value:job.status}]}],actions};
  if(Buffer.byteLength(JSON.stringify(card))>26000) {
    // Preserve all chosen sections/facts, but bound their values for Teams delivery.
    const shrink=(node:any):void=>{if(node.text)node.text=clip(node.text,160);if(node.facts)for(const f of node.facts)f.value=clip(f.value,80);for(const key of ['body','items','actions'])for(const child of node[key]??[])shrink(child);if(node.card)shrink(node.card);};
    shrink(card);card.body.push(text('긴 상세 일부를 줄였습니다. 전체 대화는 업무 허브 탭에서 확인하세요.'));
  }
  return { ...base, attachmentLayout:'list', attachments:[{contentType:'application/vnd.microsoft.card.adaptive',content:card}] };
}
