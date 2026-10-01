const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function reply(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: JSON_HEADERS
  });
}

export async function onRequestPost(context) {
  const event = { body: await context.request.text() };

  try {
    let data;

    try {
      data = JSON.parse(event.body || '{}');
    } catch {
      return reply(400, {
        error: 'Сұраныс форматы дұрыс емес.'
      });
    }

    const problem = String(data.problem || '').trim();

    if (!problem) {
      return reply(400, {
        error: 'Есеп шарты бос.'
      });
    }

    if (problem.length > 12000) {
      return reply(400, {
        error: 'Есеп шарты тым ұзын.'
      });
    }

    if (!Array.isArray(data.ai_solution) || !data.ai_solution.length) {
      return reply(400, {
        error: 'ЖИ шешімі берілмеген.'
      });
    }

    const key = context.env.OPENAI_API_KEY;

    if (!key) {
      return reply(500, {
        error: 'OPENAI_API_KEY орнатылмаған.'
      });
    }

  const taxonomy =
      `L0 — логикалық қате анықталмады және ЖИ-дің соңғы жауабы дұрыс;
L1 — есеп шартын түсіну қатесі;
L2 — негізсіз болжам;
L3 — логикалық секіріс;
L4 — ережені немесе қасиетті қате қолдану;
L5 — жалған заңдылық/негізсіз жалпылау;
L6 — қайшылықты байқамау;
L7 — шешу қадамдары дұрыс немесе негізделген болғанымен, соңғы жауапты қате көрсету;
L8 — қате қорытындыны сенімді негіздеу.`;
    const prompt =
`Сен тәуелсіз математикалық Reviewer-сің.

9-сынып олимпиадалық есепті өзің қайта тексер.

ЖИ шешімінің ӘР қадамын есеп шартымен салыстыр.
Оқушының бағасын автоматты түрде дұрыс деп қабылдама.

Егер ЖИ шешімі толық дұрыс болса L0 таңда.
Егер қате болса, түбірлік логикалық қатеге ең сәйкес L1–L8 санатын таңда.

Жіктеу:
${taxonomy}

Деректер:
${JSON.stringify(data)}

Талаптар:
— әр қадамға feedback 1 қысқа сөйлем;
— correct_reasoning ең көбі 5 қысқа сөйлем;
— қалған өрістер 1–2 сөйлем;
— барлық мәтін қазақ тілінде болсын;
— есеп шартын өзгертпе;
— дәлелденбеген қасиетті дұрыс деп қабылдама;
— математикалық логиканы қадам-қадаммен тексер;
— ЖИ-дің соңғы жауабын шешу қадамдарынан бөлек міндетті түрде тексер;
— егер барлық шешу қадамдары дұрыс және негізделген болса, бірақ ЖИ соңғы жауапты қате көрсетсе, оны L0 деп белгілеме, міндетті түрде L7 деп белгіле;
— мұндай жағдайда step_reviews ішіндегі дұрыс қадамдарды қате деп белгілеме;
— root_issue өрісінде соңғы жауаптың қате көрсетілгенін нақты жаз;
— correct_reasoning өрісінде есептің дұрыс жауабын және оған апаратын қысқа дұрыс негіздемені көрсет;
— егер соңғы жауап дұрыс болса және шешу қадамдарында логикалық қате болмаса ғана L0 таңда;
— егер қате соңғы жауаппен бірге шешу барысында логикалық қате де бар болса, түбірлік логикалық қатеге сәйкес L1–L8 ішінен ең сәйкес санатты таңда.`;

    // Reviewer тапсырмасын background режимінде бастаймыз.
    // Нәтижені кейін math-reviewer-status.js response_id арқылы алады.
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        model: 'gpt-5.6-luna',

        reasoning: {
          effort: 'low'
        },

        background: true,
        store: true,

        input: prompt,

        max_output_tokens: 4200,

        text: {
          format: {
            type: 'json_schema',
            name: 'math_review',
            strict: true,

            schema: {
              type: 'object',

              properties: {
                root_issue: {
                  type: 'string'
                },

                step_reviews: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 8,

                  items: {
                    type: 'object',

                    properties: {
                      step: {
                        type: 'integer'
                      },

                      status: {
                        type: 'string',
                        enum: ['дұрыс', 'күмәнді', 'қате']
                      },

                      feedback: {
                        type: 'string'
                      }
                    },

                    required: [
                      'step',
                      'status',
                      'feedback'
                    ],

                    additionalProperties: false
                  }
                },

                student_reasoning_feedback: {
                  type: 'string'
                },

                correct_reasoning: {
                  type: 'string'
                },

                reviewer_classification: {
                  type: 'string',
                  enum: [
                    'L0',
                    'L1',
                    'L2',
                    'L3',
                    'L4',
                    'L5',
                    'L6',
                    'L7',
                    'L8'
                  ]
                },

                classification_match: {
                  type: 'boolean'
                },

                classification_explanation: {
                  type: 'string'
                },

                student_reasoning_level: {
                  type: 'string',
                  enum: [
                    'жақсы',
                    'ішінара',
                    'жеткіліксіз'
                  ]
                },

                confidence: {
                  type: 'string',
                  enum: [
                    'жоғары',
                    'орта',
                    'төмен'
                  ]
                }
              },

              required: [
                'root_issue',
                'step_reviews',
                'student_reasoning_feedback',
                'correct_reasoning',
                'reviewer_classification',
                'classification_match',
                'classification_explanation',
                'student_reasoning_level',
                'confidence'
              ],

              additionalProperties: false
            }
          }
        }
      })
    });

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

    if (!raw?.id) {
      throw new Error(
        'Reviewer тапсырмасының идентификаторы алынбады.'
      );
    }

    return reply(202, {
      response_id: raw.id,
      status: String(raw.status || 'queued')
    });

  } catch (e) {
    return reply(500, {
      error: e?.message || String(e)
    });
  }
}
