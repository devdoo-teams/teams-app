import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrchestrationPanelView, type OrchestrationPanelViewProps } from '../src/client/OrchestrationPanel.js';
const job = { id:'task-visible',prompt:'현재 요청',status:'completed',mode:'read-only',progress:[],result:'현재 응답',createdAt:'2026-10-06T00:00:00Z' };
const props = { phase:'ready',jobs:[job],providers:[],selectedJob:job,prompt:'',providerId:'',mode:'read-only',modelId:'',reasoningEffort:'',inputValue:'',busyAction:'',error:'',notice:'',validationError:'',lastUpdatedAt:'',mobile:true,
  conversation:{ selectedJobId:job.id,complete:false,unavailableReason:'previous-turn-unavailable',turns:[{jobId:job.id,request:'<script>request</script>',response:'<img src=x onerror=alert(1)>',status:'completed',progress:[],tools:[],createdAt:job.createdAt,truncated:false}] }
} as unknown as OrchestrationPanelViewProps;
const markup=renderToStaticMarkup(<OrchestrationPanelView {...props} />);
assert.match(markup,/aria-label="작업 대화 이력"/,'selected task should render user-visible conversation');
assert.match(markup,/이전 대화 일부를 불러올 수 없습니다/);
assert.match(markup,/&lt;script&gt;request&lt;\/script&gt;/);
assert.doesNotMatch(markup,/<script>|<img src=x/);
assert.match(markup,/도구 결과 원문은 저장되지 않았습니다/);
console.log('PASS: real selected detail renders bounded visible conversation, missing-history notice and escaped content');
