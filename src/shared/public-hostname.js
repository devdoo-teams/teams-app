const dnsHostnamePattern = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function isValidPublicHostname(value) {
  return typeof value === 'string'
    && value === value.trim()
    && value !== 'localhost'
    && !value.startsWith('127.')
    && dnsHostnamePattern.test(value);
}
