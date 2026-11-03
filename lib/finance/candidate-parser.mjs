// A bounded, review-only extractor for identifiable standalone income columns.
// Each token has normalized left/right/center and vertical center coordinates.
const title = /\b(?:statement of profit\s+or\s*loss|statement of income|income statement)\b|قائمة (?:الربح او الخسارة|الدخل)/i;
const months = [
  ['january','يناير'], ['february','فبراير'], ['march','مارس'],
  ['april','ابريل'], ['may','مايو'], ['june','يونيو'],
  ['july','يوليو'], ['august','اغسطس'], ['september','سبتمبر'],
  ['october','اكتوبر'], ['november','نوفمبر'], ['december','ديسمبر'],
];
const tidy = value => value.normalize('NFKC').toLowerCase().replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) % 16))
  .replace(/[أإآ]/g, 'ا').replace(/[\u064b-\u065f\u0640]/g, '').replace(/\s+/g, ' ').trim();
const amount = value => {
  const token = tidy(value).replace(/\u066c/g, ',').replace(/\u066b/g, '.').replace(/\u2212/g, '-').replace(/^\((.+)\)$/, '-$1');
  if (!/^-?(?:0|[1-9]\d{0,14}|[1-9]\d{0,2}(?:,\d{3}){1,4})(?:\.\d{1,9})?$/.test(token)) return null;
  const raw = token.replace(/,/g, '');
  return raw.replace(/[-.]/g, '').replace(/^0+/, '').length <= 15 ? raw : null;
};
const rowKinds = [
  ['revenue', /^(?:revenue|revenues|الايرادات|الايراد)$/],
  ['grossProfit', /^(?:gross profit|اجمالي الربح|مجمل الربح)$/],
  ['operatingProfit', /^(?:operating profit|profit from operations|الربح التشغيلي|ربح التشغيل)$/],
  ['netProfit', /^(?:shareholders of the company|owners of the parent|equity holders of the parent company|bank[’']s shareholders|مساهمي الشركة|مساهمو الشركة|ملاك الشركة الام)$/],
];
const explicitNonSar = /\b(?:usd|eur|aed|kuwaiti dinars|us dollars)\b|دولار امريكي|درهم اماراتي/i;
const explicitSar = /\b(?:sar|saudi riyals?)\b|ريال سعودي|ريالات سعودية|﷼/i;

export function parseOcrTsv(tsv, width, height) {
  if (!width || !height || typeof tsv !== 'string') return [];
  return tsv.split('\n').flatMap(line => {
    const [level,,,,,,left,top,w,h,confidence, ...parts] = line.split('\t');
    const text = parts.join('\t').trim();
    if (level !== '5' || !text || Number(confidence) < 20) return [];
    return [{text,left:Number(left)/width,right:(Number(left)+Number(w))/width,y:(Number(top)+Number(h)/2)/height,h:Number(h)/height,confidence:Number(confidence)}];
  });
}

function groupLines(tokens) {
  const lines = [];
  for (const token of [...tokens].filter(w => w.text && Number.isFinite(w.y) && Number.isFinite(w.left) && Number.isFinite(w.right)).sort((a,b) => a.y-b.y)) {
    const previous = lines.at(-1);
    if (previous && token.y - previous.y <= 0.006) previous.words.push(token);
    else lines.push({y:token.y,words:[token]});
  }
  return lines.map(({y,words}) => {
    words.sort((a,b) => a.left-b.left);
    return {y,words,text:tidy(words.map(w => w.text).join(' '))};
  });
}

function scaleFrom(text) {
  if (/\bmillions?\b|مليون/.test(text)) return 6;
  if (/\bthousands?\b|آلاف|الاف|(?:^|[\s(#])['’‘`ʼ]000(?=[\s)]|$)/.test(text)) return 3;
  return null;
}

export function candidateContext(documentText) {
  const text = tidy(documentText);
  const unit = text.match(/(?:presented in|presentation currency is|بالريال السعودي|تعرض[^.]{0,60}بالريال السعودي)[^.]{0,280}/g) ?? [];
  const evidence = unit.join(' ');
  const currency = explicitSar.test(evidence) && !explicitNonSar.test(evidence) ? 'SAR' : null;
  const rounded = text.match(/rounded to the nearest (?:thousand|million)|مقربة الى اقرب (?:الف|مليون)/g) ?? [];
  const scales = new Set(rounded.map(match => scaleFrom(match) ?? (/الف/.test(match) ? 3 : null)));
  return {currency,scale:scales.size === 1 ? [...scales][0] : null};
}

/** @param {Array<{text:string,left:number,right:number,y:number,confidence?:number}>} tokens
 * @param {{documentPeriod:string,page:number,source:'text'|'ocr',context?:{currency:string|null,scale:number|null}}} options */
export function parseFinancialPage(tokens, {documentPeriod, page, source, context = {currency:null,scale:null}}) {
  const period = /^(\d{4})-Q([1-4])$/.exec(documentPeriod);
  if (!period) return [];
  const [,year,quarter] = period;
  const priorYear = String(Number(year)-1);
  const lines = groupLines(tokens);
  const titleIndex = lines.findIndex((line,index) => title.test(line.text) || title.test(line.text + ' ' + (lines[index+1]?.text ?? '')));
  if (titleIndex === -1) return [];
  const heading = lines.slice(Math.max(0,titleIndex-2), titleIndex+3).map(line=>line.text).join(' ');
  const consolidated = /\bconsolidated\b|الموحدة/.test(heading);
  const standalone = /\bstandalone\b|\bseparate\b|المستقلة/.test(heading);
  const scope = consolidated === standalone ? null : consolidated ? 'consolidated' : 'standalone';
  const revenueRow = rowKinds.find(([metric]) => metric === 'revenue')[1];
  const bodyStart = lines.findIndex((line,index) => index > titleIndex &&
    (line.text === 'income' || revenueRow.test(line.text.replace(/\s+\(?\d.*$/, ''))));
  if (bodyStart === -1) return [];
  const header = lines.slice(titleIndex+1, bodyStart);
  const headerText = header.map(line=>line.text).join(' ');
  if (explicitNonSar.test(headerText)) return [];
  const currency = explicitSar.test(headerText) ? 'SAR' : context.currency;
  const scale = scaleFrom(headerText) ?? context.scale;
  const center = word => (word.left+word.right)/2;
  const yearLine = header.findLast(line => line.words.some(w => tidy(w.text) === year) && line.words.some(w => tidy(w.text) === priorYear));
  if (!yearLine) return [];
  const yearWords = yearLine.words.filter(w => [year,priorYear].includes(tidy(w.text)));
  const headerWindow = header.filter(line => line.y < yearLine.y && yearLine.y-line.y < 0.075);
  const startMonth = months[(Number(quarter)-1)*3];
  const endMonth = months[Number(quarter)*3-1];
  const hasMonth = (column, names) => headerWindow.some(line => line.words.some(word =>
    Math.abs(center(word)-center(column)) < 0.075 &&
    names.includes(tidy(word.text).replace(/[-–—]$/, '').trim()) &&
    yearWords.reduce((closest, other) => Math.abs(center(word)-center(other)) < Math.abs(center(word)-center(closest)) ? other : closest, yearWords[0]) === column));
  let columns = yearWords.filter(column => hasMonth(column,startMonth) && hasMonth(column,endMonth));
  if (columns.length === 0 && yearWords.length === 4 && quarter !== '1') {
    // Some filings put one duration heading over a pair of year columns.
    // Require distinct three-month and YTD headings, and the same quarter-end
    // month under both headings before mapping either pair.
    const ytd = {2:'six',3:'nine',4:'twelve'}[quarter];
    const duration = new RegExp('^for the (three|'+ytd+')[ -]months? period$');
    for (const line of headerWindow) {
      const groups = [];
      for (const word of line.words) {
        const prior = groups.at(-1);
        if (prior && word.left-prior.at(-1).right < 0.025) prior.push(word);
        else groups.push([word]);
      }
      const headings = groups.map(group => ({
        length: duration.exec(tidy(group.map(word=>word.text).join(' ')))?.[1],
        x: center(group[0]),
      })).filter(group=>group.length);
      if (headings.length !== 2 || new Set(headings.map(group=>group.length)).size !== 2) continue;
      const paired = headings.map((group,index) => ({...group,years:yearWords.slice(index*2,index*2+2)}));
      if (!paired.every(group => new Set(group.years.map(w=>tidy(w.text))).size === 2 &&
        Math.abs(group.x-center(group.years[0])) < 0.075 &&
        headerWindow.some(dateLine=>dateLine.y > line.y && dateLine.words.some(word => endMonth.includes(tidy(word.text)) &&
          Math.abs(center(word) - group.years.map(center).reduce((a,b)=>a+b,0)/2) < 0.08)))) continue;
      columns = paired.find(group=>group.length === 'three').years;
      break;
    }
  }
  if (columns.filter(w=>tidy(w.text)===year).length !== 1 || columns.filter(w=>tidy(w.text)===priorYear).length !== 1) return [];
  const firstX = Math.min(...yearWords.map(center));
  const facts = [];
  const seen = new Set();
  for (let index=bodyStart; index<lines.length; index++) {
    const line = lines[index];
    const row = line.words.filter(word => word.right < firstX-0.07).map(word=>word.text).join(' ').trim().replace(/\s+\d{1,2}$/, '');
    const match = rowKinds.find(([,pattern]) => pattern.test(tidy(row)));
    if (!match) continue;
    const [metric] = match;
    if (seen.has(metric)) return [];
    if (metric === 'netProfit' && !/attributable|العائد|المنسوب/.test(lines[index-1]?.text ?? '')) continue;
    seen.add(metric);
    for (const column of columns) {
      const neighboring = yearWords.filter(w => w !== column).map(w=>Math.abs(center(w)-center(column)));
      const maximumDistance = Math.min(0.065, Math.min(...neighboring)*0.5);
      const cellWords = line.words.filter(word => Math.abs(center(word)-center(column)) < maximumDistance);
      if (cellWords.some(word => /^[()−-]$/.test(word.text.trim()))) continue;
      const values = cellWords.filter(word => amount(word.text) !== null);
      if (values.length !== 1 || (source === 'ocr' && values[0].confidence < 65)) continue;
      const columnYear = tidy(column.text);
      facts.push({
        metric,period:columnYear+'-Q'+quarter,rawValue:amount(values[0].text),scale,scope,currency,page,source,
        table:'قائمة الربح أو الخسارة',row,column:columnYear+' · الربع '+quarter+' المستقل',
      });
    }
  }
  return facts;
}
