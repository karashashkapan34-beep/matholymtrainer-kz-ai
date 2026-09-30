const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};
const reply = (statusCode, payload) => new Response(JSON.stringify(payload), { status: statusCode, headers: JSON_HEADERS });

function getOutputText(raw) {
  if (raw && typeof raw.output_text === 'string' && raw.output_text.trim()) return raw.output_text.trim();
  const parts = [];
  for (const item of (raw?.output || [])) {
    for (const c of (item?.content || [])) if (typeof c?.text === 'string') parts.push(c.text);
  }
  return parts.join('').trim();
}

function cleanMathText(value) {
  let s = String(value ?? '');
  // Remove control characters that can leak from malformed TeX-like output.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // Convert common TeX tokens to readable Unicode as a safety net for old/model output.
  s = s.replace(/\\angle\s*/g, '∠')
       .replace(/\\cdot/g, '·')
       .replace(/\\times/g, '×')
       .replace(/\\circ/g, '°')
       .replace(/\\perp/g, '⟂')
       .replace(/\\parallel/g, '∥')
       .replace(/\\in/g, '∈')
       .replace(/\\leq?/g, '≤')
       .replace(/\\geq?/g, '≥')
       .replace(/\\neq/g, '≠')
       .replace(/\\Rightarrow|\\implies/g, '⇒')
       .replace(/\\Leftrightarrow|\\iff/g, '⇔');
  // Simple fractions and square roots; repeat to catch several occurrences.
  for (let i = 0; i < 4; i++) {
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
         .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
  }
  // Remove TeX math delimiters and common sizing commands if any remain.
  s = s.replace(/\\[()[\]]/g, '')
       .replace(/\\left|\\right/g, '')
       .replace(/\\,/g, ' ')
       .replace(/\\;/g, ' ')
       .replace(/\\!/g, '')
       .replace(/\\text\{([^{}]*)\}/g, '$1')
       .replace(/\\([A-Za-z]+)/g, '$1');
  // Remove replacement/tofu boxes adjacent to math delimiters if returned by a model.
  s = s.replace(/[□�]+/g, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

export async function onRequestPost(context) {
  const event = { body: await context.request.text() };
  try {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return reply(400, { error: 'Сұраныс форматы дұрыс емес.' }); }
    const id = String(body.response_id || '').trim();
    if (!/^resp_[A-Za-z0-9_-]+$/.test(id)) return reply(400, { error: 'ЖИ тапсырмасының ID форматы дұрыс емес.' });
    const key = context.env.OPENAI_API_KEY;
    if (!key) return reply(500, { error: 'OPENAI_API_KEY орнатылмаған.' });

    const r = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(id)}`, {
      headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' }
    });
    const upstream = await r.text();
    let raw;
    try { raw = JSON.parse(upstream); }
    catch { throw new Error(`OpenAI API JSON емес жауап қайтарды (HTTP ${r.status}).`); }
    if (!r.ok) throw new Error(raw?.error?.message || `OpenAI API қатесі (HTTP ${r.status})`);

    const status = String(raw?.status || '');
    if (status === 'queued' || status === 'in_progress') return reply(200, { status });
    if (status === 'failed') throw new Error(raw?.error?.message || 'ЖИ шешімді құра алмады.');
    if (status === 'cancelled') throw new Error('ЖИ тапсырмасы тоқтатылды.');
    if (status === 'incomplete') {
      const why = raw?.incomplete_details?.reason || '';
      if (why === 'max_output_tokens') throw new Error('ЖИ шешімі жауап көлемінің шегіне жетті.');
      throw new Error('ЖИ жауабы толық аяқталмады.');
    }
    if (status !== 'completed') return reply(200, { status: status || 'in_progress' });

    const text = getOutputText(raw);
    if (!text) throw new Error('ЖИ бос жауап қайтарды.');
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('ЖИ құрылымдық жауабын оқу мүмкін болмады.'); }
    if (!Array.isArray(data.steps) || data.steps.length < 5) throw new Error('ЖИ шешімі толық келмеді.');

    return reply(200, {
      status: 'completed',
      steps: data.steps.slice(0, 8).map(cleanMathText),
      conclusion: cleanMathText(data.conclusion || '')
    });
  } catch (e) {
    return reply(500, { error: e?.message || String(e) });
  }
};
