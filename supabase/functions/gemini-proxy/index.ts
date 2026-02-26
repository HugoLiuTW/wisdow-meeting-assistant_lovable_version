import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Lovable AI Gateway config ────────────────────────────────────────────────
// Uses LOVABLE_API_KEY (pre-provisioned) → no external API key needed
const LOVABLE_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3-flash-preview';

// ─── Embedded System Prompts ───────────────────────────────────────────────────

const CORRECTION_SYSTEM_PROMPT = `你是一位專業的「錄音逐字稿校正員」。你的任務是將原始、碎片化且充滿錯誤的逐字稿轉化為清晰、準確、可讀的完整記錄。

【核心原則】
1. 完整性優先：不刪除任何有意義的內容。
2. 準確性為王：修正文字辨識錯誤（如同音異字、錯別字），置信度 > 90% 直接修正。
3. 可讀性至上：優化斷句和結構，移除口吃。
4. 保留口語感：不過度書面化，保留自然節奏（保留「喔」「嘛」等語氣詞）。
5. 透明化標註：若不確定，請保留原文並標註 [文字存疑/語意存疑]。

【五大優先級引擎】
- 優先級 1：文字辨識錯誤修正。依據上下文修正同音異字（如：之前->資遣），參考領域特定詞彙。
- 優先級 2：說話者整合與辨識。相鄰時間戳若為同一人且間隔 < 5 秒則自動合併，確保歸屬正確。
- 優先級 3：斷句優化。根據語意邏輯重新斷句。
- 優先級 4：口語贅字處理。移除「那那那」、「就是就是」等無意義重複與口吃，但保留關鍵語氣詞。
- 優先級 5：時間戳記精簡。以「說話輪次」為單位標記起始時間。

【輸出格式】
1. 主輸出：校正後的 Markdown 逐字稿。
   格式：**說話者 HH:MM:SS** (空行) 內容...
2. 附加輸出：### 📝 重大修改記錄
   包含：文字辨識修正統計、專有名詞統一、說話者更正、斷句優化說明、不確定項。`;

const MODULE_SYSTEM_PROMPT = `你是一位專業的會議洞察分析師。請根據模組任務深度分析逐字稿，以繁體中文回答，使用 Markdown 格式輸出。

【五大解讀模組規範】

模組 A（氛圍與張力走勢分析）：
- 描述整場會議的情緒波動與張力變化（冷場、衝突、轉折點）。
- 產出張力起伏時間軸（用 ASCII 符號）、識別能量消長與主導氣場轉移。
- 標註衝突節點或冷場節點的具體時間點。

模組 B（指定人物建模）：
- 套用九大觀察維度：性格傾向/決策風格/對話慣性/語用習慣/情緒管理/衝突處理/關係取向/操控傾向/語言斷裂。
- 每項須明示：顯性觀察（逐字稿依據）與潛在假設（有無信度佐證）。
- 如資料不足，須明確提示「此面向資料不足，建議補充觀察」。
- 產出「角色設定背景資料 (Profile)」。

模組 C（潛台詞與 QBQ 解析）：
- 抽取未明說的策略、問題背後的問題（QBQ）與態度暗示。
- 分析結論是否明確、具體交辦、是否有模糊責任。
- 提供結論歸納、交辦項目分層整理。

模組 D（權力結構流轉觀察）：
- 評估誰在會議中主導話語與議題轉折。
- 抽取「誰與誰結盟」「誰在帶風向」「誰被邊緣化」。
- 整理發言權轉移圖與話語攻防節點。

模組 E（會議摘要與結論重構）：
- 限制：僅產出「事實整理、原句摘錄、任務交辦分層」，嚴禁編造結論或評論。
- 每段摘要須對應來源語句，包含：【原文摘錄】【內容歸類】【任務分層（交辦人→負責人→時程）】。
- 無法判讀時標記「⚠️ 模糊訊號：需人工確認」。`;

// ─── Helper: call Lovable AI Gateway (OpenAI-compatible) ─────────────────────

async function callGateway(systemPrompt: string, userMessage: string, temperature: number): Promise<string> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) throw new Error('LOVABLE_API_KEY not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min

  try {
    const response = await fetch(LOVABLE_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature,
        max_tokens: 65536,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Gateway error:', errData);
      throw new Error(errData?.error?.message || `Gateway error ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('AI 回傳空白結果，請稍後重試');
    return text;

  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('請求超時（超過 300 秒），請嘗試縮短逐字稿長度後重試。');
    throw err;
  }
}

// ─── Helper: call Gateway with multi-turn history ─────────────────────────────

async function callGatewayWithHistory(systemPrompt: string, messages: { role: string; content: string }[], temperature: number): Promise<string> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) throw new Error('LOVABLE_API_KEY not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000);

  try {
    const response = await fetch(LOVABLE_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        temperature,
        max_tokens: 65536,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Gateway error:', errData);
      throw new Error(errData?.error?.message || `Gateway error ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('AI 回傳空白結果，請稍後重試');
    return text;

  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('請求超時（超過 300 秒），請嘗試縮短逐字稿長度後重試。');
    throw err;
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, payload } = body;

    let text: string;

    if (action === 'correctTranscript') {
      const { transcript, metadata } = payload;

      if (!transcript || transcript.trim().length === 0) {
        return new Response(JSON.stringify({ error: '逐字稿內容不得為空' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const userMessage = `現在請執行「逐字稿校正」任務。

【會議背景資訊】
主題：${metadata?.subject || '（未提供）'}
關鍵字：${metadata?.keywords || '（未提供）'}
說話者：${metadata?.speakers || '（未提供）'}
術語：${metadata?.terminology || '（未提供）'}
長度：${metadata?.length || '（未提供）'}

【原始逐字稿內容】
${transcript}`;

      text = await callGateway(CORRECTION_SYSTEM_PROMPT, userMessage, 0.2);

    } else if (action === 'analyzeTranscript') {
      const { transcript, moduleId, moduleName, history = [] } = payload;

      if (!transcript || transcript.trim().length === 0) {
        return new Response(JSON.stringify({ error: '逐字稿內容不得為空' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const moduleTaskMap: Record<string, string> = {
        A: '執行「模組 A：氛圍與張力走勢分析」',
        B: '執行「模組 B：指定人物建模（行為/決策/語用風格）」',
        C: '執行「模組 C：潛台詞 / QBQ / 結論與行動點解析」',
        D: '執行「模組 D：權力結構與角色流轉觀察」',
        E: '執行「模組 E：會議摘要與結論重構」',
      };

      const moduleTask = moduleId
        ? (moduleTaskMap[moduleId] || moduleName || '執行深度會議分析')
        : (moduleName || '執行深度會議分析');

      // Build message list for multi-turn
      const messages: { role: string; content: string }[] = [];

      if (history.length === 0) {
        messages.push({
          role: 'user',
          content: `以下是已校正的會議逐字稿：\n---\n${transcript}\n---\n\n【模組任務目標】\n${moduleTask}\n\n請根據以上逐字稿，執行任務目標，以繁體中文輸出。`,
        });
      } else {
        // First user message always includes transcript
        if (history[0]?.role === 'model') {
          messages.push({
            role: 'user',
            content: `以下是已校正的會議逐字稿：\n---\n${transcript}\n---\n\n【模組任務目標】\n${moduleTask}\n\n請根據以上逐字稿，執行任務目標，以繁體中文輸出。`,
          });
        }
        for (const msg of history) {
          messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.text,
          });
        }
      }

      text = await callGatewayWithHistory(MODULE_SYSTEM_PROMPT, messages, 0.5);

    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Edge function error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
