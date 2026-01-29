import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateResearchPlan, refineResearchPlan, analyzeTranscripts, generateProjectReport } from './geminiDelegate.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Polyfill for using VITE_ env vars if GEMINI_API_KEY is not set directly
if (!process.env.GEMINI_API_KEY && process.env.VITE_GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY;
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Global Error Handler for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// API Routes
app.post('/api/generate-plan', async (req, res) => {
    try {
        const context = req.body;
        const plan = await generateResearchPlan(context);
        res.json(plan);
    } catch (error) {
        console.error('Error generating plan:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/refine-plan', async (req, res) => {
    try {
        const { plan, instructions } = req.body;
        const refinedPlan = await refineResearchPlan(plan, instructions);
        res.json(refinedPlan);
    } catch (error) {
        console.error('Error refining plan:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/analyze', async (req, res) => {
    try {
        const { transcript } = req.body;
        const result = await analyzeTranscripts(transcript);
        res.json(result);
    } catch (error) {
        console.error('Error analyzing transcript:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/report', async (req, res) => {
    try {
        const { projectTitle, sessions } = req.body;
        const report = await generateProjectReport(projectTitle, sessions);
        res.json(report);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  
  app.get('*', (req, res) => {
    // Exclude API routes from wildcard match to prevent returning index.html for 404 APIs
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API not found' });
    }
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
