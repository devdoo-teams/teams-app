export type RemoteTroubleshootingCode =
  | 'codex-cli-auth'
  | 'teams-cli-auth'
  | 'browser-unavailable'
  | 'sideload-policy'
  | 'sso-uri-mismatch'
  | 'package-validation'
  | 'network'
  | 'unknown';

export interface RemoteTroubleshootingAdvice {
  code: RemoteTroubleshootingCode;
  summary: string;
  nextAction: string;
}

export function diagnoseRemoteTroubleshooting(input: string): RemoteTroubleshootingAdvice {
  const text = input.toLowerCase();

  if (/browser is not available|iab.*(?:unavailable|없|연결)|인앱 브라우저.*(?:없|연결되지|unavailable)|브라우저.*(?:연결.*없|not available)/i.test(text)) {
    return {
      code: 'browser-unavailable',
      summary: '원격 Codex 프로세스에서는 부모 Codex 앱의 인앱 브라우저를 제어할 수 없습니다.',
      nextAction: '브라우저 재연결을 반복하지 말고, 로컬 검증을 완료한 뒤 부모 세션에서만 로그인·업로드를 진행하세요.',
    };
  }

  if (/sideload(?:ing)?[^\n]*(?:not allowed|blocked)|upload custom apps|사용자 지정 앱.*(?:차단|막)|sideload.*허용되지/i.test(text)) {
    return {
      code: 'sideload-policy',
      summary: 'Teams 사용자 정책이 CLI 사용자 지정 앱 업로드를 차단했습니다.',
      nextAction: 'Developer Portal 업로드를 사용하거나 Teams Admin Center에서 Upload custom apps 정책을 확인하세요.',
    };
  }

  if (/application[_ ]?id[_ ]?uri|application id uri|application_id_uri/i.test(text) && /(?:mismatch|불일치|expected|match)/i.test(text)) {
    return {
      code: 'sso-uri-mismatch',
      summary: '패키지의 SSO 리소스 URI와 Entra 등록 URI가 일치하지 않습니다.',
      nextAction: 'Entra에 등록된 실제 URI를 유지하고, Dev Tunnel URI로 추측해 덮어쓰지 마세요. 운영 SSO 전환 때만 등록값과 도메인을 함께 변경하세요.',
    };
  }

  if (/teams (?:cli )?(?:status|login)[^\n]*(?:not logged|로그인.*(?:아니|필요|되지))|teams cli.*(?:not logged|로그인)/i.test(text)) {
    return {
      code: 'teams-cli-auth',
      summary: 'Teams CLI 인증이 완료되지 않았습니다.',
      nextAction: 'Teams CLI 디바이스 인증을 한 번 완료한 뒤 `teams status`가 Logged in인지 확인하세요.',
    };
  }

  if (/codex login[^\n]*(?:not logged|로그인.*(?:아니|필요|되지))|codex cli.*(?:not logged|로그인)|loggedin:\s*false/i.test(text)) {
    return {
      code: 'codex-cli-auth',
      summary: 'Codex CLI 인증이 완료되지 않았습니다.',
      nextAction: '`codex login status`를 확인하고, 필요할 때만 Codex CLI의 device-auth 흐름을 한 번 완료하세요.',
    };
  }

  if (/zip|package|패키지|manifest|매니페스트/i.test(text) && /(?:invalid|validation|검증.*실패|업로드.*(?:실패|대기|미실행)|not uploaded)/i.test(text)) {
    return {
      code: 'package-validation',
      summary: '앱 패키지 또는 업로드 검증이 완료되지 않았습니다.',
      nextAction: '패키지 버전·실제 ZIP 매니페스트·devicePermissions를 확인한 뒤 업로드 결과를 직접 확인하세요.',
    };
  }

  if (/timeout|timed out|시간 제한|network|네트워크|connection refused|연결 거부/i.test(text)) {
    return {
      code: 'network',
      summary: '명령 실행 또는 외부 서비스 연결이 시간 초과/네트워크 오류로 끝났습니다.',
      nextAction: '원인을 한 번 기록하고 재시도 횟수를 제한하세요. 같은 오류가 반복되면 외부 서비스 상태를 확인하세요.',
    };
  }

  return { code: 'unknown', summary: '', nextAction: '' };
}

export function diagnoseRemoteAgentResult(input: string): RemoteTroubleshootingAdvice {
  if (!/(?:^|\n)STATUS:\s*(?:BLOCKED|FAILED)\b/i.test(input)) {
    return { code: 'unknown', summary: '', nextAction: '' };
  }

  if (/(?:^|\n)BLOCKER:\s*(?:NONE|없음)\b/i.test(input)) {
    return { code: 'unknown', summary: '', nextAction: '' };
  }

  return diagnoseRemoteTroubleshooting(input);
}

export function formatRemoteTroubleshooting(advice: RemoteTroubleshootingAdvice): string {
  if (advice.code === 'unknown') return '';
  return `진단 코드: ${advice.code}\n${advice.summary}\n다음 단계: ${advice.nextAction}`;
}
