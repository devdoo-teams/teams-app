import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-copilot-ui-public-types-'));
try {
  fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}\n');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
  const fixture = path.join(temporary, 'contract.tsx');
  fs.writeFileSync(fixture, `
import { HttpAgent, AbstractAgent } from '${root}/types/release-stubs/ag-ui-client.js';
import { CopilotKit, CopilotChat, CopilotChatView, CopilotChatConfigurationProvider, useAgent, useRenderTool, useRenderToolCall } from '${root}/types/release-stubs/copilotkit-react-core-v2.js';
import { z } from 'zod';
const agent = new HttpAgent({ agentId: 'execution-projection', url: 'https://synthetic.invalid/api/copilot-ui/agent/execution-projection/run' });
agent.fetch = async () => Response.json({});
agent.setMessages([]);
agent.setState({});
void agent.runAgent({ tools: [], context: [], forwardedProps: { jobId: 'synthetic-job' } });
void AbstractAgent.prototype.abortRun.call(agent);
useAgent({ agentId: 'execution-projection' });
useAgent({ agentId: 'local-view', runtimeAgentId: 'execution-projection', threadId: 'synthetic-thread' });
// @ts-expect-error A thread cannot bind to a shared agent without an explicit runtime agent.
useAgent({ agentId: 'execution-projection', threadId: 'synthetic-thread' });
// @ts-expect-error A runtime agent requires both local agent id and thread id.
useAgent({ runtimeAgentId: 'execution-projection' });
useRenderTool({ name: 'showProjection', agentId: 'execution-projection', parameters: z.object({ title: z.string() }),
  render: props => {
    if (props.status === 'complete') {
      const title: string = props.parameters.title;
      // @ts-expect-error Parameters retain their named schema instead of any.
      const privateOwner: string = props.parameters.privateOwner;
      return <p>{title}</p>;
    }
    return <p>Loading</p>;
  }
});
useRenderTool({ name: '*', agentId: 'execution-projection', render: () => <></> });
const Hidden = () => null;
const safe = <CopilotKit runtimeUrl='/api/copilot-ui' agent='execution-projection' headers={() => ({})}
  credentials='same-origin' useSingleEndpoint={false} enableInspector={false} showDevConsole={false}>
  <CopilotChat agentId='execution-projection' welcomeScreen={false}
    autoScroll='none' messageView={{ assistantMessage: { markdownRenderer: Hidden, toolbar: Hidden } }} />
</CopilotKit>;
// @ts-expect-error Headers are string values, never an arbitrary untyped record.
const badHeaders = <CopilotKit headers={{ Authorization: true }}><p /></CopilotKit>;
// @ts-expect-error Undeclared SDK props are not silently accepted.
const badProp = <CopilotChat arbitraryOwner='foreign-owner' />;
void safe; void badHeaders; void badProp;
const visible = <CopilotChatConfigurationProvider agentId='execution-projection'>
  <CopilotChatView messages={[{id:'one',role:'user',content:'synthetic'}]} inputValue='draft' onInputChange={value => { const text:string=value; }}
    onSubmitMessage={value => { const prompt:string=value; }} input={{mode:'input',textArea:{maxLength:2000,disabled:false},sendButton:{disabled:false}}} />
</CopilotChatConfigurationProvider>;
useRenderToolCall()({toolCall:{id:'tool',type:'function',function:{name:'showProjection',arguments:'{}'}},toolMessage:{id:'result',role:'tool',toolCallId:'tool',content:'{}'}});
// @ts-expect-error A controlled composer supplies a string, never a caller-selected owner object.
const invalidSubmit = <CopilotChatView onSubmitMessage={(value:{owner:string})=>{}} />;
void visible; void invalidSubmit;
`);
  const program = ts.createProgram([fixture], {
    strict: true, skipLibCheck: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    esModuleInterop: true, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const output = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n',
  });
  assert.equal(diagnostics.length, 0, `Installed public SDK methods and strict supported view slots are missing:\n${output}`);
  const actualFixture = path.join(temporary, 'installed-contract.tsx');
  fs.writeFileSync(actualFixture, fs.readFileSync(fixture,'utf8')
    .replace(`'${root}/types/release-stubs/ag-ui-client.js'`, "'@ag-ui/client'")
    .replace(`'${root}/types/release-stubs/copilotkit-react-core-v2.js'`, "'@copilotkit/react-core/v2'"));
  const actual = ts.createProgram([actualFixture], program.getCompilerOptions());
  const actualDiagnostics = ts.getPreEmitDiagnostics(actual);
  assert.equal(actualDiagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(actualDiagnostics,{
    getCurrentDirectory:()=>root,getCanonicalFileName:file=>file,getNewLine:()=> '\n',
  }));
  console.log('PASS: release stubs preserve typed HttpAgent, exact useAgent forms, schema-inferred render props and supported read-only chat slots');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
