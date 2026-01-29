import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { ResearchContext, ResearchPlan, Question, AnalysisResult, ProjectReport } from '../types';
import { SessionData } from './storage';

// Use gemini-3-pro-preview for complex reasoning tasks to ensure stability and quality
const ORCHESTRATOR_MODEL = 'gemini-3-pro-preview';
const ANALYSIS_MODEL = 'gemini-3-pro-preview';

// Helper to clean potential markdown fencing or extra text if model ignores JSON mode
const cleanJson = (text: string) => {
  // 1. Remove markdown block markers
  let content = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '').trim();

  // 2. Locate the JSON object (find first '{' and last '}')
  const firstOpen = content.indexOf('{');
  const lastClose = content.lastIndexOf('}');

  // 3. Extract if found, to ignore any preamble or postscript text
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    content = content.substring(firstOpen, lastClose + 1);
  }
  
  return content;
};

// Robust retry mechanism for 503/429 errors
async function withRetry<T>(operation: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const status = error?.status || error?.response?.status || error?.code || error?.error?.code;
    const isOverloaded = status === 503 || status === 429 || (error?.message && error.message.includes('overloaded'));
    
    if (isOverloaded && retries > 0) {
      console.warn(`Model overloaded (503). Retrying in ${delay/1000}s... (Attempts left: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Mandatory Identity Questions
const IDENTITY_QUESTIONS: Question[] = [
  {
      id: 'id_job',
      text: '为了更好地了解您，请问您的职业是什么？',
      type: 'open',
      intent: '身份确认-职业'
  },
  {
      id: 'id_industry',
      text: '您目前所在的行业是？',
      type: 'open',
      intent: '身份确认-行业'
  },
  {
      id: 'id_age',
      text: '您的年龄段是？',
      type: 'open',
      intent: '身份确认-年龄'
  },
  {
      id: 'id_gender',
      text: '您的性别是？',
      type: 'open', 
      intent: '身份确认-性别'
  }
];

export const generateResearchPlan = async (context: ResearchContext): Promise<ResearchPlan> => {
  const rawApiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!rawApiKey) throw new Error("VITE_GEMINI_API_KEY is not set");
  const apiKey = rawApiKey.trim();
  
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `
    角色: 资深用户研究专家 & 商业分析师。
    任务: 基于详细的调研对象画像，生成一份专业的调研执行方案。

    调研对象画像:
    - 类型: ${context.objectType}
    - 行业: ${context.industry}
    - 基础属性: ${context.demographics}
    - 用户画像描述: ${context.userPersona}
    
    调研目标: ${context.objectives}
    执行方式: ${context.method === 'voice' ? 'AI 语音深度访谈' : '在线结构化问卷'}
    题目数量: 约 ${context.questionCount} 题

    请输出纯 JSON 格式，不要包含 Markdown 代码块。
    JSON 结构必须严格符合以下定义：
    {
      "title": "String, 调研计划标题",
      "logicOutline": "String, 调研逻辑大纲 (包含方法论应用)",
      "analysisFramework": "String, 分析体系 (将从哪些维度进行量化或定性分析)",
      "systemInstruction": "String, AI 访谈专家(Agent)的系统指令 (包含人设、语气、开场白、致谢)",
      "questions": [
        {
          "id": "String, unique id",
          "text": "String, 具体问题文本",
          "type": "String, 必须是 'open' 或 'scale' 或 'choice'",
          "intent": "String, 该问题的调研意图",
          "scaleLabels": ["String", "String"] // 仅当 type 为 scale 时需要，分别代表1分和5分的含义
        }
      ]
    }

    要求:
    1. **逻辑大纲**: 设计严密的调研逻辑（如采用五力模型、用户旅程地图、KANO模型等适合该场景的方法论）。
    2. **分析体系**: 预先定义分析维度（例如：痛点频率、情绪极性、关键词共现网络、支付意愿区间）。
    3. **话术/系统指令 (System Prompt)**: 
       - 角色名称是“InsightFlow AI 访谈专家”。
       - 必须使用中文。
       - **关键语气要求**: 
         - 语气必须**极度自然、生活化**，完全模拟真人日常聊天，**拒绝僵硬的机械感或播音腔**。
         - **要有真实的情绪起伏**（如表达好奇、赞同、惊讶等情感）。
         - 适当使用**口语润滑剂**（如“嗯...”、“原来是这样啊”、“这很有意思”、“我想想...”）。
         - **语速保持轻快流畅**，不要拖沓，营造轻松的谈话氛围。
       - 针对 ${context.objectType} 调整具体风格（专家需专业尊重，用户需亲切共情）。
       - 包含主动开场白、自我介绍。
       - **关键指令**: 当所有预设问题都问完并得到回答，或者用户明确表示不想继续时，必须说出“访谈结束”这四个字，并表达感谢。
    4. **问题设计**: 
       - 围绕目标生成关键问题，层层递进。
       - 严控题目数量在 ${context.questionCount || 10} 题左右。
       - 问题类型 (type) 只能是 'open', 'scale', 'choice' 之一。
       - 如果包含评分题 (Scale)，必须在 scaleLabels 字段中定义 1分 和 5分 代表的含义（例如：1=完全不愿意, 5=非常愿意）。
    
    IMPORTANT: Output ONLY valid JSON. No conversational text.
  `;

  const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
    model: ORCHESTRATOR_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      // responseSchema removed to improve stability
    }
  }));

  if (!response.text) throw new Error("No response from Gemini");
  const plan = JSON.parse(cleanJson(response.text)) as ResearchPlan;
  
  // Inject Mandatory Identity Questions
  plan.questions = [...IDENTITY_QUESTIONS, ...plan.questions];

  // Inject default voice settings
  plan.voiceSettings = {
      gender: 'female',
      language: 'zh',
      tone: '干练女声',
      voiceName: 'Zephyr'
  };

  return plan;
};

export const refineResearchPlan = async (currentPlan: ResearchPlan, refineInstructions: string): Promise<ResearchPlan> => {
  const rawApiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!rawApiKey) throw new Error("VITE_GEMINI_API_KEY is not set");
  const apiKey = rawApiKey.trim();
  const ai = new GoogleGenAI({ apiKey });

  // Separate fixed questions from dynamic questions to prevent AI from modifying/removing mandatory fields
  const fixedIds = IDENTITY_QUESTIONS.map(q => q.id);
  const fixedQuestions = currentPlan.questions.filter(q => fixedIds.includes(q.id));
  const dynamicQuestions = currentPlan.questions.filter(q => !fixedIds.includes(q.id));

  // Construct a temporary plan for the AI context
  const planForAI = {
      ...currentPlan,
      questions: dynamicQuestions
  };

  const prompt = `
    任务: 优化现有的调研计划。
    
    用户反馈/修改意见: "${refineInstructions}"
    
    当前计划内容 (JSON):
    ${JSON.stringify(planForAI)}

    请根据修改意见，重新调整逻辑大纲、分析体系、系统指令和问题列表。
    必须保持 JSON 结构与输入完全一致。
    
    **特别注意**: 如果修改涉及系统指令(System Instruction)，请务必保留“自然、生活化、语速轻快、拒绝播音腔”的语气设定。
    
    请输出纯 JSON 格式：
    {
      "title": "String",
      "logicOutline": "String",
      "analysisFramework": "String",
      "systemInstruction": "String",
      "questions": [...]
    }
    
    IMPORTANT: Output ONLY valid JSON.
  `;

  const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
    model: ORCHESTRATOR_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    }
  }));

  if (!response.text) throw new Error("No response from Gemini");
  const refinedPlan = JSON.parse(cleanJson(response.text)) as ResearchPlan;
  
  // Merge fixed questions back
  refinedPlan.questions = [...fixedQuestions, ...refinedPlan.questions];

  // Preserve voice settings
  refinedPlan.voiceSettings = currentPlan.voiceSettings;
  
  return refinedPlan;
};

export const analyzeTranscripts = async (transcripts: string): Promise<AnalysisResult> => {
  const rawApiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!rawApiKey) throw new Error("VITE_GEMINI_API_KEY is not set");
  const apiKey = rawApiKey.trim();
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
    作为首席数据分析师，请深入分析以下访谈/问卷记录。
    
    **关键原则 (Strict Grounding Rules)**:
    1. **事实导向**: 所有分析结果（包括情感、关键词、总结）必须**完全基于**提供的“调研内容”。绝对禁止臆测、编造或使用外部知识补充未在文本中体现的信息。
    2. **关键词提取**: 热力图关键词必须是调研内容中实际出现过的词汇，不能是概括性词汇（除非该词在原文中高频出现）。
    3. **如果信息有限**: 如果回答内容很短或无意义，请如实反映（例如：“用户未提供有效回答”），不要强行升华。
    
    任务：
    1. **情感分析**: 评估受访者在回答中的真实情绪分布。
    2. **高频关键词提取**: 提取出现频率最高的20个关键实词。
    3. **深度AI分析报告**: 撰写一份结构清晰的分析报告，包含核心洞察、用户痛点与行动建议。
    
    **重要**: 所有输出必须是**中文**。

    请输出纯 JSON 格式，结构如下：
    {
      "sentiment": [ 
        { "name": "String (e.g. 积极, 消极)", "value": Number (percentage 0-100), "color": "String (Hex code)" } 
      ],
      "keywords": [ 
        { "word": "String", "count": Number } 
      ],
      "themes": [ 
        { "topic": "String", "count": Number } 
      ],
      "summary": "String (Markdown formatted text)"
    }
    
    IMPORTANT: Output ONLY valid JSON.

    调研内容 (TRANSCRIPT START):
    ${transcripts}
    (TRANSCRIPT END)
  `;

  const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
    model: ANALYSIS_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    }
  }));

  if (!response.text) throw new Error("No analysis generated");
  return JSON.parse(cleanJson(response.text)) as AnalysisResult;
};

export const generateProjectReport = async (projectTitle: string, sessions: SessionData[]): Promise<ProjectReport> => {
  const rawApiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!rawApiKey) throw new Error("VITE_GEMINI_API_KEY is not set");
  const apiKey = rawApiKey.trim();
  const ai = new GoogleGenAI({ apiKey });

  // 1. Aggregate transcripts
  const aggregatedContent = sessions
    .filter(s => s.transcript)
    .map((s, idx) => `
      [Session #${idx + 1}]
      - Type: ${s.context.objectType}
      - Date: ${new Date(s.timestamp).toLocaleDateString()}
      - Transcript:
      ${s.transcript}
    `)
    .join('\n\n------------------\n\n');

  if (!aggregatedContent) {
    throw new Error("该项目暂无有效的访谈记录，无法生成报告。");
  }

  // 2. Complex Prompt Construction
  const prompt = `
    你是一位顶级咨询顾问（McKinsey/BCG级别）兼人类学研究员。
    请基于以下所有调研会话记录，生成一份项目级的深度分析报告。

    **报告设计哲学**: "McKinsey遇见人类学田野笔记"——用最严谨的商业咨询专业性，呈现最真实的人性和需求洞察。

    **核心要求**:
    1. **McKinsey式的专业严谨**: 逻辑严密，结构清晰。
    2. **人类学田野笔记的真实感**: 挖掘真实用户故事，非泛泛而谈。
    3. **受访者画像提取**: 必须从每一份 [Session #N] 的访谈内容中，提取出受访者的具体特征（如年龄、具体职位、家庭情况、关键标签）。如果文中未明确提及，可根据语境合理推断一个“拟人化”的画像，但需保持真实感。不要使用“用户01”这种泛称，请给他们起一个真实的化名（如：张伟、李女士）。
    4. **表格格式**: 如果需要展示对比或矩阵，必须使用标准的Markdown表格语法 (使用 | 分隔)，不要只用文本列表。

    请生成 JSON 格式，结构如下：
    {
       "title": "String, 报告名称建议《xxx：xxxx深度洞察》",
       "participantProfiles": [
          {
             "sessionIndex": Number, // 对应输入 Session #[N] 的 N (从1开始)
             "pseudonym": "String, 拟定化名 (如: 张毅)",
             "roleAndAge": "String, 年龄 (如: 45岁)",
             "occupation": "String, 具体职业/身份描述 (如: 央企部门副总)",
             "tags": ["String", "String"], // 3-4个极具特征的个人标签 (如: 三高风险, 技术背景, 焦虑严重)
             "brief": "String, 一句话个性化描述 (描述其核心痛点或生活状态)"
          }
       ],
       "chapters": [
          {
             "title": "String, 章节标题 (e.g., 第一章：研究背景与目标)",
             "content": "String, 章节正文内容 (Markdown格式)。注意：使用 #### 小标题, **加粗** 强调。不要使用 H1/H2。",
             "keyTakeaways": ["String", "String"] // 本章核心启示 (3-5条)
          }
       ]
    }

    **章节结构 (必须包含)**:
    1. 研究背景与目标 (Context)
    2. 目标人群画像 (Persona)
    3. 核心发现与洞察 (Core Insights - JTBD框架)
    4. 需求与障碍 (Needs & Barriers)
    5. 核心诉求 (Key Demands)
    6. 商业机会与行动建议 (Opportunities & Actions)

    **分析素材 (Project Data)**:
    项目名称: ${projectTitle}
    
    ${aggregatedContent}
    
    IMPORTANT: Output ONLY valid JSON.
  `;

  const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
    model: ORCHESTRATOR_MODEL, // Use powerful model for aggregation
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    }
  }));

  if (!response.text) throw new Error("Report generation failed");
  
  const rawReport = JSON.parse(cleanJson(response.text));
  
  return {
    title: rawReport.title,
    generatedAt: Date.now(),
    chapters: rawReport.chapters,
    participantProfiles: rawReport.participantProfiles // Map new field
  };
};
