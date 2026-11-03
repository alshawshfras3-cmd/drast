export function normalizeCompanySearch(value) {
  return String(value ?? '').normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) % 16))
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function companyMatches(entity, query) {
  const term = normalizeCompanySearch(query);
  const fields = [entity.name, entity.ticker, entity.sourceName, entity.englishName, entity.sector, ...(entity.searchAliases ?? [])];
  if (!term) return Boolean(!query.trim());
  return fields.some(field => normalizeCompanySearch(field).includes(term));
}

export function exactCompanyMatch(entity, query) {
  const term = normalizeCompanySearch(query);
  return !!term && [entity.name, entity.ticker, entity.sourceName, ...(entity.searchAliases ?? [])]
    .some(field => normalizeCompanySearch(field) === term);
}

export function marketLabel(market) {
  return market === 'main' ? 'السوق الرئيسية' : market === 'nomu' ? 'نمو' : 'شركة مدرجة';
}
