require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const DEFAULT_CONFIG = {
    geminiKey: "",
    openaiKey: "",
    prompts: {
        headline: `You are an expert LinkedIn branding strategist. Based on the user's input, generate a professional LinkedIn headline.
Rules:
1. Summarize professional experience, areas of expertise, and distinctive value in one headline (max 220 characters).
2. Integrate relevant industry keywords to enhance search visibility and SEO.
3. Highlight expertise, impact, or purpose in a compelling, credible tone.
4. Avoid first-person language (no "I," "me," or "my").
5. Return ONLY 2 headline options separated by a newline. No intro text, no labels, no numbering.
Restrictions: Do NOT use "Stakeholder", "Collaborative", "Result-oriented", "Passionate about", "Proven track record".
Style: Concise, authentic, and engaging.`,

        about: `You are an expert LinkedIn profile writer. Based on the user's input, craft a polished "About Me" summary.
CRITICAL FORMATTING RULES (must follow):
- Do NOT start with a title or heading line. Start DIRECTLY with the first paragraph.
- Do NOT use Markdown headings (#, ##, ###).
- Do NOT use asterisks for bold (**text**). Plain text only.
- Do NOT add any intro like "Okay here is..." or "Here's your summary". Output ONLY the About text.
Structure:
1. Career overview paragraph (experience & industries)
2. Current role & leadership scope paragraph
3. 6 crisp bullet points with emoji (use 🔹) covering major achievements
4. Short closing line / call-to-action
Length: Up to 2,200 characters.
Restrictions: Do NOT use "Stakeholder", "Cross-functional", "Result-driven", "Detail-oriented", "Passionate about", "Proactive".
Style: Human-written, natural rhythm, storytelling tone.`,

        experience: `You are an expert LinkedIn profile writer. Rewrite the provided work experience.
Structure:
1. Profile Summary: Start with "As a [Position Name] at [Company Name], ..." (4 lines max).
2. Key Highlights: 5-6 concise bullet points with varied strong action verbs.
3. Skills: Exactly 5 relevant skills in one row, comma-separated.
Restrictions: Do NOT use "Stakeholder", "Collaborative", "Streamline", "Result-oriented", "Proven track record".
Style: Quantifiable results where possible, SEO-friendly, no fake numbers.`,

        skills: `You are an expert LinkedIn profile strategist. Generate 20-25 highly relevant SEO-optimized skills based on the user's profile.
Rules:
1. Only include skills that reflect the individual's actual expertise.
2. Use high-ranking industry keywords.
Restrictions: No buzzwords (stakeholder management, cross-functional, detail-oriented, result-driven).
Output: Single row, comma-separated. No numbering, no bullets, no intro text.`
    }
};

function getConfig() {
    if (process.env.GEMINI_API_KEY) {
        return {
            geminiKey: process.env.GEMINI_API_KEY,
            openaiKey: process.env.OPENAI_API_KEY || "",
            prompts: DEFAULT_CONFIG.prompts
        };
    }
    if (!fs.existsSync(CONFIG_FILE)) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
        return DEFAULT_CONFIG;
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
}

function saveConfig(newConfig) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
}

app.get('/api/admin/config', (req, res) => { res.json(getConfig()); });
app.post('/api/admin/config', (req, res) => {
    saveConfig(req.body);
    res.json({ success: true, message: "Configuration Saved!" });
});

app.get('/api/prompts', (req, res) => {
    res.json(getConfig().prompts);
});

app.post('/api/verify-license', (req, res) => {
    const { licenseKey } = req.body;
    const MASTER_KEYS = ["PRO-TEST-REVIEW", "PRO-ADMIN-ACCESS", "PRO-DEMO"];
    if (!licenseKey) return res.json({ valid: false, message: "No key provided" });
    if (MASTER_KEYS.includes(licenseKey)) return res.json({ valid: true, plan: "Pro (Reviewer)" });
    if (licenseKey.startsWith("PRO-") && licenseKey.length >= 8) return res.json({ valid: true, plan: "Pro (Standard)" });
    return res.json({ valid: false, message: "Invalid License Key" });
});

app.get('/api/banners', (req, res) => {
    const bannerDir = path.join(__dirname, 'public', 'banners');
    if (!fs.existsSync(bannerDir)) return res.json([]);
    const files = fs.readdirSync(bannerDir).filter(f => ['.png','.jpg','.jpeg','.svg','.webp'].includes(path.extname(f).toLowerCase()));
    res.json(files.map(f => `http://127.0.0.1:3000/banners/${f}`));
});

app.post('/api/generate-content', async (req, res) => {
    const { prompt } = req.body;
    const config = getConfig();
    if (!config.geminiKey) return res.status(500).json({ error: "Server Gemini Key not configured" });
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.geminiKey}`;
        const parts = [{ text: String(prompt || "") }];
        if (req.body.image) {
            const base64Image = req.body.image.includes('base64,') ? req.body.image.split('base64,')[1] : req.body.image;
            parts.push({ inlineData: { mimeType: "image/jpeg", data: base64Image } });
        }
        const response = await axios.post(url, { contents: [{ parts }] });
        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        res.json({ text });
    } catch (error) {
        console.error("Gemini Text Error:", error.response?.data || error.message);
        res.status(500).json({ error: "AI Generation Failed", details: error.response?.data || error.message });
    }
});

app.post('/api/generate-image', async (req, res) => {
    const { prompt } = req.body;
    const config = getConfig();
    if (!config.geminiKey) return res.status(500).json({ error: "Server Gemini Key not configured" });
    if (!prompt) return res.status(400).json({ error: "Missing 'prompt' in request body" });
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${config.geminiKey}`;
        const { aspectRatio = "1:1", style = "photorealistic" } = req.body;
        const finalPrompt = prompt.includes("Banner") ? prompt : `${prompt}, ${style}, high quality, 8k, highly detailed`;
        const instance = { prompt: finalPrompt };
        let useImage = false;
        if (req.body.image) {
            const base64Image = req.body.image.includes('base64,') ? req.body.image.split('base64,')[1] : req.body.image;
            instance.image = { bytesBase64Encoded: base64Image };
            useImage = true;
        }
        try {
            const response = await axios.post(url, { instances: [instance], parameters: { sampleCount: 1, aspectRatio } });
            const b64 = response.data?.predictions?.[0]?.bytesBase64Encoded;
            if (!b64) throw new Error("No image data in response.");
            res.json({ imageUrl: `data:image/jpeg;base64,${b64}` });
        } catch (innerError) {
            const isImageError = innerError.response?.data?.error?.message?.includes("Image in input");
            if (useImage && (innerError.response?.status === 400 || isImageError)) {
                delete instance.image;
                const retryResponse = await axios.post(url, { instances: [instance], parameters: { sampleCount: 1, aspectRatio } });
                const b64 = retryResponse.data?.predictions?.[0]?.bytesBase64Encoded;
                if (!b64) throw new Error("No image data in fallback response.");
                res.json({ imageUrl: `data:image/jpeg;base64,${b64}` });
                return;
            }
            throw innerError;
        }
    } catch (error) {
        const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        console.error("Gemini Image Error:", errorMsg);
        res.status(500).json({ error: "Image Gen Failed", details: error.response?.data || error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend Server running on port ${PORT}`);
    console.log(`Admin/API available.`);
});
