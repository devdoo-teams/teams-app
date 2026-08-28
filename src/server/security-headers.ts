const TEAMS_FRAME_ANCESTORS = [
  "'self'",
  'https://teams.microsoft.com',
  'https://*.teams.microsoft.com',
  'https://*.microsoft365.com',
  'https://*.office.com',
  'https://outlook.office.com',
  'https://outlook.office365.com',
  'https://outlook-sdf.office.com',
  'https://outlook-sdf.office365.com',
  'https://*.cloud.microsoft',
];

export function buildSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      'img-src https: data: blob:',
      'font-src https: data:',
      'connect-src https: wss: blob:',
      `frame-ancestors ${TEAMS_FRAME_ANCESTORS.join(' ')}`,
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}
