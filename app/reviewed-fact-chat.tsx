'use client';

import { useState, type FormEvent } from 'react';

type Citation = {documentId:string; documentName:string; page:number; table:string; row:string; column:string};
type Result =
  | {status:'answer'; metric:string; scope:string; rows:{period:string; value?:string; unit?:string; citation?:Citation}[]}
  | {status:'clarify' | 'unreviewed'; message:string; periods?:string[]};

export default function ReviewedFactChat({studyId}:{studyId:string}) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<{question:string; result:Result}[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = question.trim();
    if (!submitted || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/research/reviewed-facts', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({studyId, question:submitted}),
      });
      if (!response.ok) {
        const {error} = await response.json() as {error?:string};
        throw Error(error || 'تعذّر إرسال السؤال.');
      }
      const result = await response.json() as Result;
      setTurns(previous => [...previous.slice(-9), {question:submitted, result}]);
      setQuestion('');
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'تعذّر إرسال السؤال.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="financial-fact-register" aria-label="محادثة الأرقام المراجعة">
    <h3>اسأل عن الأرقام المراجعة</h3>
    <p>تجيب المحادثة من سجل هذه الدراسة. مثال: كم الإيرادات في آخر ربع؟</p>
    <form onSubmit={ask}>
      <label htmlFor="reviewed-fact-question">سؤالك عن المؤشر والفترة</label>
      <div className="section-row">
        <input id="reviewed-fact-question" value={question} maxLength={300} disabled={busy}
          onChange={event=>setQuestion(event.target.value)} placeholder="كم الإيرادات في آخر ربع؟" required />
        <button className="btn secondary" disabled={busy || !question.trim()}>{busy ? 'جارٍ البحث…' : 'إرسال'}</button>
      </div>
    </form>
    {error && <p role="alert">{error}</p>}
    <div role="log" aria-label="سجل المحادثة">
      {turns.map(({question,result}, index) => <article key={index}>
        <h4>{question}</h4>
        {result.status === 'answer' ? <>
          <p>{result.metric} · {result.scope}</p>
          <ul>{result.rows.map(({period,value,unit,citation}) => <li key={period}>
            <bdi>{period}</bdi>{citation ? <>
              {' · '}<bdi>{value}</bdi> {unit}
              <br/><a href={'/api/documents?id='+encodeURIComponent(citation.documentId)+'&download=true'}>
                {citation.documentName} · صفحة {citation.page}
              </a>
              <br/>{citation.table} · {citation.row} · {citation.column}
            </> : ' · الرقم غير متاح في سجل الدراسة المراجع.'}
          </li>)}</ul>
        </> : <p>{result.message} {result.periods?.length ? <>الفترات المتاحة: {result.periods.map(period=><span key={period}> <bdi>{period}</bdi></span>)}</> : null}</p>}
      </article>)}
    </div>
  </section>;
}
