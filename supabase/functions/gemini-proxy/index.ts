import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action, payload } = body;

    let geminiPayload: any;

    if (action === 'correctTranscript') {
      const { transcript, metadata } = payload;
      geminiPayload = {
        system_instruction: {
          parts: [{ text: '你是一位專業的錄音逐字稿校正員。請根據校正規則進行處理。' }]
        },
        contents: [{
          role: 'user',
          parts: [{
            text: `現在請執行「逐字稿校正」任務。

【會議背景資訊】
主題：${metadata.subject}
關鍵字：${metadata.keywords}
說話者：${metadata.speakers}
術語：${metadata.terminology}
長度：${metadata.length}

【原始逐字稿內容】
${transcript}`
          }]
        }],
        generationConfig: { temperature: 0.2 }
      };
    } else if (action === 'analyzeTranscript') {
      const { transcript, modulePrompt, history = [] } = payload;

      const systemInstruction = '你是一位專業的會議洞察分析師。請根據模組任務深度分析逐字稿，以繁體中文回答，使用 Markdown 格式輸出。';

      let contents: any[];

      if (history.length === 0) {
        contents = [{
          role: 'user',
          parts: [{
            text: `以下是已校正的會議逐字稿：\n---\n${transcript}\n---\n\n【模組任務目標】\n${modulePrompt}\n\n請根據以上逐字稿，執行任務目標，以繁體中文輸出。`
          }]
        }];
      } else {
        contents = [];
        // If first message is from model, prepend initial user prompt
        if (history[0]?.role === 'model') {
          contents.push({
            role: 'user',
            parts: [{ text: `以下是已校正的會議逐字稿：\n---\n${transcript}\n---\n\n【模組任務目標】\n${modulePrompt}\n\n請根據以上逐字稿，執行任務目標，以繁體中文輸出。` }]
          });
        }
        for (const msg of history) {
          contents.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
          });
        }
      }

      geminiPayload = {
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.5 }
      };
    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiResponse.ok) {
      const errData = await geminiResponse.json();
      return new Response(JSON.stringify({ error: errData?.error?.message || 'Gemini API error' }), {
        status: geminiResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await geminiResponse.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
