const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function reply(statusCode, payload) {
  return new Response(
    JSON.stringify(payload),
    { status: statusCode, headers: JSON_HEADERS }
  );
}

function getOutputText(raw) {
  if (
    raw &&
    typeof raw.output_text === 'string' &&
    raw.output_text.trim()
  ) {
    return raw.output_text.trim();
  }

  const parts = [];

  for (const item of (raw?.output || [])) {
    for (const c of (item?.content || [])) {
      if (typeof c?.text === 'string') {
        parts.push(c.text);
      }
    }
  }

  return parts.join('').trim();
}

export async function onRequestPost(context) {
  try {
    let body;

    try {
      body = await context.request.json();
    } catch {
      return reply(400, {
        error: 'Сұраныс форматы дұрыс емес.'
      });
    }

    const responseId = String(
      body.response_id || ''
    ).trim();

    if (!responseId) {
      return reply(400, {
        error: 'Reviewer тапсырмасының идентификаторы берілмеген.'
      });
    }

    const key = context.env.OPENAI_API_KEY;

    if (!key) {
      return reply(500, {
        error: 'OPENAI_API_KEY орнатылмаған.'
      });
    }

    const r = await fetch(
      `https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const upstreamText = await r.text();

    let raw;

    try {
      raw = JSON.parse(upstreamText);
    } catch {
      throw new Error(
        `Reviewer API JSON емес жауап қайтарды (HTTP ${r.status}).`
      );
    }

    if (!r.ok) {
      throw new Error(
        raw?.error?.message ||
        `OpenAI API қатесі (HTTP ${r.status})`
      );
    }

    const status = String(raw?.status || '');

    if (
      status === 'queued' ||
      status === 'in_progress'
    ) {
      return reply(200, { status });
    }

    if (status === 'failed') {
      throw new Error(
        raw?.error?.message ||
        'Reviewer тапсырмасын орындай алмады.'
      );
    }

    if (status === 'cancelled') {
      throw new Error(
        'Reviewer тапсырмасы тоқтатылды.'
      );
    }

    if (status === 'incomplete') {
      const reason =
        raw?.incomplete_details?.reason || '';

      if (reason === 'max_output_tokens') {
        throw new Error(
          'Reviewer жауабы көлем шегіне жетті.'
        );
      }

      throw new Error(
        'Reviewer жауабы толық аяқталмады.'
      );
    }

    if (status !== 'completed') {
      return reply(200, {
        status: status || 'in_progress'
      });
    }

    const text = getOutputText(raw);

    if (!text) {
      throw new Error(
        'Reviewer бос жауап қайтарды.'
      );
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        'Reviewer құрылымдық жауабын оқу мүмкін болмады.'
      );
    }

    if (
      !/^L[0-8]$/.test(
        String(data.reviewer_classification || '')
      )
    ) {
      throw new Error(
        'Reviewer жіктеу форматы дұрыс емес.'
      );
    }

    if (!Array.isArray(data.step_reviews)) {
      throw new Error(
        'Reviewer қадамдық бағалау бермеді.'
      );
    }

    return reply(200, {
      status: 'completed',
      ...data
    });

  } catch (e) {
    return reply(500, {
      error: e?.message || String(e)
    });
  }
}
