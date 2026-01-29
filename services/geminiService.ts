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

const API_BASE = '/api';

export const generateResearchPlan = async (context: ResearchContext): Promise<ResearchPlan> => {
  const response = await fetch(`${API_BASE}/generate-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context)
  });
  if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || 'Failed to generate plan');
  }
  const plan = await response.json();
  
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

export const refineResearchPlan = async (currentPlan: ResearchPlan, instructions: string): Promise<ResearchPlan> => {
  const response = await fetch(`${API_BASE}/refine-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: currentPlan, instructions })
  });
  if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || 'Failed to refine plan');
  }
  return response.json();
};

export const analyzeTranscripts = async (transcript: string): Promise<AnalysisResult> => {
  const response = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript })
  });
  if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || 'Failed to analyze');
  }
  return response.json();
};

export const generateProjectReport = async (projectTitle: string, sessions: SessionData[]): Promise<ProjectReport> => {
  const response = await fetch(`${API_BASE}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectTitle, sessions })
  });
  if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || 'Failed to generate report');
  }
  return response.json();
};
