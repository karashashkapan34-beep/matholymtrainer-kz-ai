const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function reply(statusCode, payload) {
  return new Response(JSON.stringify(payload), { status: statusCode, headers: JSON_HEADERS });
}

function getOutputText(raw) {
  if (raw && typeof raw.output_text === 'string' && raw.output_text.trim()) return raw.output_text.trim();
  const parts = [];
  for (const item of (raw?.output || [])) {
    for (const c of (item?.content || [])) {
      if (typeof c?.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('').trim();
}

export async function onRequestPost(context) {
  const event = { body: await context.request.text() };
  try {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return reply(400, { error: 'Сұраныс форматы дұрыс емес.' }); }

    const topic = String(body.topic || '');
    const problem = String(body.problem || '').trim();
    if (!problem) return reply(400, { error: 'Есеп шарты бос.' });
    if (problem.length > 12000) return reply(400, { error: 'Есеп шарты тым ұзын.' });

    const key = context.env.OPENAI_API_KEY;
    if (!key) return reply(500, { error: 'OPENAI_API_KEY орнатылмаған.' });

    const prompt = `Сен 9-сынып олимпиадалық математика есептерін шешетін ЖИ-сің. Бөлім: ${topic}.\nЕсеп: ${problem}\n\nЕсепті мұқият шеш. Оқушыға 5–8 бірізді математикалық қадам бер. Әр қадамда БІР негізгі логикалық әрекет болсын. Дәлелді қысқартпа, бірақ артық түсіндірме қоспа: әр қадам 1–3 қысқа сөйлемнен тұрсын. Есеп шартын өзгертпе және дәлелденбеген қасиетті қолданба. Соңғы қорытындыны жеке бер. Жауап қазақ тілінде болсын. Барлық математикалық жазуды тек Unicode таңбаларымен бер: ∠, ·, ×, =, ≠, ≤, ≥, √, ², ³, °, →, ⇔, ∥, ⟂, ∈. ЕШҚАНДАЙ LaTeX командасын немесе кері қиғаш сызықты қолданба: \angle, \frac, \sqrt, \cdot, \circ, \(, \) жазуға болмайды. Бөлшектерді (a+b)/(c+d) түрінде, индекстерді x₁, x₂ түрінде жаз. Формуланы код блогына салма. Әр қадам мәтіні таза, оқулықтағыдай оқылатын болсын.`;

    // Start the OpenAI response in background mode. This function returns quickly,
    // so Netlify's synchronous execution window is no longer tied to the full proof time.
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        reasoning: { effort: 'none' },
        background: true,
        store: true,
        input: prompt,
        max_output_tokens: 2600,
        text: {
          format: {
            type: 'json_schema',
            name: 'math_solution',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                steps: {
                  type: 'array',
                  minItems: 5,
                  maxItems: 8,
                  items: { type: 'string' }
                },
                conclusion: { type: 'string' }
              },
              required: ['steps', 'conclusion'],
              additionalProperties: false
            }
          }
        }
      })
    });
    const upstreamText = await r.text();
    let raw;
    try { raw = JSON.parse(upstreamText); }
    catch { throw new Error(`OpenAI API JSON емес жауап қайтарды (HTTP ${r.status}).`); }
    if (!r.ok) throw new Error(raw?.error?.message || `OpenAI API қатесі (HTTP ${r.status})`);
    if (!raw?.id) throw new Error('ЖИ тапсырмасының идентификаторы алынбады.');

    // Usually status is queued/in_progress here. The browser polls math-solver-status.
    // If it happened to finish immediately, the status endpoint can still retrieve it by id.
    return reply(202, { response_id: raw.id, status: String(raw.status || 'queued') });
  } catch (e) {
    return reply(500, { error: e?.message || String(e) });
  }
};
