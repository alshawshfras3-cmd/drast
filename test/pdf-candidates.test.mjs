import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateContext, parseFinancialPage, parseOcrTsv } from '../lib/finance/candidate-parser.mjs';

const word = (text, x, y, confidence = 99) => ({text,left:x-0.014,right:x+0.014,y,confidence});
const context = candidateContext('Statements are presented in Saudi Riyals. All amounts have been rounded to the nearest thousand.');
const options = {documentPeriod:'2026-Q3', page:6, source:'ocr', context};
const tokens = [
  word('Condensed consolidated statement of profit or loss',0.38,0.10),
  ...['July','July','January','January'].map((text,i)=>word(text,0.55+i*0.10,0.13)),
  ...['September','September','September','September'].map((text,i)=>word(text,0.55+i*0.10,0.145)),
  ...['2026','2025','2026','2025'].map((text,i)=>word(text,0.55+i*0.10,0.16)),
  word('‘000',0.55,0.18),
  word('Revenue',0.15,0.22),word('10',0.48,0.22),
  ...['6,187,398','5,552,599','18,215,656','16,608,091'].map((text,i)=>word(text,0.55+i*0.10,0.22)),
  word('Profit for the period attributable to:',0.15,0.28),
  word('Shareholders of the Company',0.15,0.30),
  ...['(617,789)','613,239','1,985,668','1,991,299'].map((text,i)=>word(text,0.55+i*0.10,0.30)),
];

test('uses aligned standalone columns and excludes the note and year-to-date totals', () => {
  const rows = parseFinancialPage(tokens, options);
  assert.deepEqual(rows.map(({metric,period,rawValue})=>[metric,period,rawValue]), [
    ['revenue','2026-Q3','6187398'], ['revenue','2025-Q3','5552599'],
    ['netProfit','2026-Q3','-617789'], ['netProfit','2025-Q3','613239'],
  ]);
  assert.ok(rows.every(row=>row.page===6 && row.currency==='SAR' && row.scale===3 && row.scope==='consolidated'));
});

test('does not infer a quarter from cumulative, incorrect or missing header periods', () => {
  const ytd = tokens.map(token=>token.text==='July' ? {...token,text:'January'} : token);
  assert.deepEqual(parseFinancialPage(ytd, options), []);
  assert.deepEqual(parseFinancialPage(tokens, {...options,documentPeriod:'2026-Q2'}), []);
  assert.deepEqual(parseFinancialPage(tokens.filter(token=>token.text!=='2025'), options), []);
});

test('omits unreliable cells and refuses an explicitly foreign presentation currency', () => {
  const low = tokens.map(token=>token.text==='6,187,398' ? {...token,confidence:64} : token);
  assert.equal(parseFinancialPage(low, options).length,3);
  assert.deepEqual(parseFinancialPage([...tokens,word('USD',0.55,0.185)], options), []);
  const unconfirmed = parseFinancialPage(tokens, {...options,context:{currency:null,scale:null}});
  assert.ok(unconfirmed.every(row=>row.currency===null));
});

test('TSV retains only recognized words and normalizes pixel positions', () => {
  const input = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '4\t1\t1\t1\t1\t0\t50\t40\t100\t20\t-1\t',
    '5\t1\t1\t1\t1\t1\t100\t40\t100\t20\t89\t1,000',
    '5\t1\t1\t1\t1\t2\t500\t40\t100\t20\t12\tgarble',
  ].join('\n');
  assert.deepEqual(parseOcrTsv(input,1000,500),[{text:'1,000',left:0.1,right:0.2,y:0.1,h:0.04,confidence:89}]);
});

const groupedHeadings = [
  word('For',0.52,0.13),word('the',0.55,0.13),word('three-month',0.58,0.13),word('period',0.61,0.13),
  word('For',0.72,0.13),word('the',0.75,0.13),word('nine-month',0.78,0.13),word('period',0.81,0.13),
  word('ended',0.53,0.145),word('30',0.56,0.145),word('September',0.59,0.145),
  word('ended',0.73,0.145),word('30',0.76,0.145),word('September',0.79,0.145),
  ...['2026','2025','2026','2025'].map((text,i)=>word(text,0.55+i*0.10,0.16)),
];

test('maps two-year columns beneath a shared quarterly heading but not beneath YTD', () => {
  const layout = [
    word('Interim consolidated statement of profit or loss',0.38,0.10),
    ...groupedHeadings,
    word('Revenue',0.15,0.22),
    ...['6,187,398','5,552,599','18,215,656','16,608,091'].map((text,i)=>word(text,0.55+i*0.10,0.22)),
    word('Net profit attributable to:',0.15,0.28),
    word('Equity holders of the Parent Company',0.15,0.30),
    ...['617,789','613,239','1,985,668','1,991,299'].map((text,i)=>word(text,0.55+i*0.10,0.30)),
  ];
  const rows = parseFinancialPage(layout,options);
  assert.deepEqual(rows.map(({metric,period,rawValue})=>[metric,period,rawValue]),[
    ['revenue','2026-Q3','6187398'],['revenue','2025-Q3','5552599'],
    ['netProfit','2026-Q3','617789'],['netProfit','2025-Q3','613239'],
  ]);
  assert.deepEqual(parseFinancialPage(layout.map(token=>token.text==='September'?{...token,text:'June'}:token),options),[]);
});

test('accepts explicit bank shareholder income without treating financing or operating income as revenue', () => {
  const layout = [
    word('Interim Consolidated Statement of income',0.38,0.10),
    word('(#’000)',0.18,0.12),
    ...groupedHeadings,
    word('Income',0.15,0.21),
    word('Total operating income',0.15,0.22),
    ...['11,114,948','9,881,774','32,527,911','28,684,749'].map((text,i)=>word(text,0.55+i*0.10,0.22)),
    word('Net income for the period attributable to:',0.15,0.28),
    word('Bank’s shareholders',0.15,0.30),
    ...['7,106,270','6,360,203','20,869,958','18,417,254'].map((text,i)=>word(text,0.55+i*0.10,0.30)),
  ];
  const rows = parseFinancialPage(layout,{...options,context:{currency:null,scale:null}});
  assert.deepEqual(rows.map(({metric,period,rawValue,scale})=>[metric,period,rawValue,scale]),[
    ['netProfit','2026-Q3','7106270',3],['netProfit','2025-Q3','6360203',3],
  ]);
});
