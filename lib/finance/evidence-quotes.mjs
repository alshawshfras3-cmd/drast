// Only whole source sentences are eligible. Table cells need their own
// period, unit and scope evidence before they can become financial facts.
const amountUnit = /(?:[%٪$﷼]|ريال|دولار|درهم|دينار|مليون|مليار|ألف|\b(?:SAR|USD|AED|million|billion|thousand|percent|bps)\b)/iu;

export function financialEvidenceQuotes(sources) {
  const quotes = [];
  for (const source of sources) {
    let count = 0;
    let page = null;
    for (const line of source.text.split(/\r?\n/)) {
      const marker = /^\[صفحة (\d+)\]$/.exec(line.trim());
      if (marker && source.kind === 'pdf') {
        page = Number(marker[1]);
        continue;
      }
      for (const candidate of line.split(/(?<=[.!؟])\s+/u)) {
        const text = candidate.trim();
        if (text.length < 12 || text.length > 420 || !/[.!؟]$/u.test(text) ||
          !/\p{Nd}/u.test(text) || !amountUnit.test(text) || text.startsWith('[')) continue;
        quotes.push({id:`${source.id}:${++count}`, sourceId:source.id, text, page});
        if (count === 4) break;
      }
      if (count === 4) break;
    }
  }
  return quotes;
}

export function formatEvidenceQuote(quote, companyName) {
  const location = quote.page ? `، صفحة ${quote.page}` : '';
  return `اقتباس من مصدر ${companyName}${location}: «${quote.text}»`;
}
