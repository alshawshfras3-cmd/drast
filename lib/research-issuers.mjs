import directory from '../data/listed-directory.json' with {type:'json'};
import {getPilotCompany, isAllowedCompanySourceUrl, PILOT_COMPANIES} from './pilot-catalog.mjs';

const issuers = new Map(directory.companies.map(record => ['listed-'+record.ticker, {
  id:'listed-'+record.ticker, ticker:record.ticker,
  name:record.searchAliases?.[0] ?? record.name,
  entityKind:'listed_company',
}]));

export function getResearchIssuer(id) {
  return getPilotCompany(id) ?? issuers.get(id) ?? null;
}

const connectedByTicker = new Map(PILOT_COMPANIES.filter(company=>company.ticker).map(company=>[company.ticker,company]));

export function getResearchConnector(id) {
  return getPilotCompany(id) ?? connectedByTicker.get(issuers.get(id)?.ticker) ?? null;
}

export const researchIssuerIds = [...PILOT_COMPANIES.map(company=>company.id), ...issuers.keys()];

const libraryPath = /^\/api\/documents\?id=([a-f0-9-]{36})&download=true$/i;

export function libraryEvidenceId(url) {
  return typeof url === 'string' ? libraryPath.exec(url)?.[1] : undefined;
}

export function allowedResearchEvidenceUrl(id, url) {
  return Boolean(libraryEvidenceId(url) && issuers.has(id)) || isAllowedCompanySourceUrl(getResearchConnector(id)?.id,url);
}

export function libraryEvidence(issuer, document) {
  if (!issuer || document?.ticker !== issuer.ticker || document.mime !== 'application/pdf' ||
      typeof document.text !== 'string' || document.text.replace(/\[صفحة \d+\]/g,'').trim().length < 32) return null;
  const url = '/api/documents?id='+document.id+'&download=true';
  if (!libraryEvidenceId(url)) return null;
  return {
    id:'library-'+document.id, companyId:issuer.id, title:String(document.name).slice(0,500),
    url, text:document.text.trim().slice(0,20000), checkedAt:document.createdAt,
    kind:'pdf', truncated:document.text.trim().length>20000,
  };
}
