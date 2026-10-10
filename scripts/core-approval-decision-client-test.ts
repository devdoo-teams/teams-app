import assert from 'node:assert/strict';
import { createCoreOrchestrationClient, CoreOrchestrationClientError } from '../src/client/core-orchestration-client.js';

const requests:Array<{path:string;init:RequestInit}>=[];
const client=createCoreOrchestrationClient(async(input,init={})=>{
  requests.push({path:String(input),init});
  return Response.json({job:{id:'synthetic-approval-owner-job',status:'queued'},replayed:false,dispatch:true});
});
assert.equal(typeof client.decideApproval,'function','durable decisions require a selected server-issued approval identity');
const identity={approvalId:'approval-12345678-1234-1234-1234-123456789abc',revision:'a'.repeat(64)};
const abort=new AbortController();
for(const decision of ['accept','deny'] as const){
  const response=await client.decideApproval!('synthetic-approval-owner-job',identity,decision,abort.signal);
  assert.equal(response.job.id,'synthetic-approval-owner-job');
  const request=requests.at(-1)!;
  assert.equal(request.path,`/api/core-orchestration/jobs/synthetic-approval-owner-job/${decision==='accept'?'approve':'deny'}`);
  assert.equal(request.init.method,'POST');
  assert.deepEqual(JSON.parse(String(request.init.body)),identity,'only the confirmed immutable identity crosses the mutation boundary');
  assert.equal(request.init.signal,abort.signal);
}
const before=requests.length;
for(const invalid of [{...identity,approvalId:'guess'}, {...identity,revision:''}, {...identity,requesterId:'other-owner'}]){
  await assert.rejects(()=>client.decideApproval!('synthetic-approval-owner-job',invalid,'accept'),
    error=>error instanceof CoreOrchestrationClientError&&error.code==='ApprovalIdentityRequired'&&!error.retryable);
}
await assert.rejects(()=>client.decideApproval!('synthetic-approval-owner-job',identity,'expire' as 'deny'));
await assert.rejects(()=>client.approveJob('synthetic-approval-owner-job'),
  error=>error instanceof CoreOrchestrationClientError&&error.code==='ApprovalIdentityRequired');
assert.equal(requests.length,before,'invalid and legacy approval never send an empty or guessed mutation');
console.log('PASS: durable approval client sends exact identity through owner API; malformed, extra-scope and legacy empty approvals fail before HTTP');
