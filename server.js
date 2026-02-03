const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = 3000;
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Default Configuration
const DEFAULT_CONFIG = {
    geminiKey: "",
    openaiKey: "",
    prompts: {
        headline: "Act as a LinkedIn Expert. Write 3 professional, SEO-optimized headlines based on the current headline. Return only 3 lines.",
        about: "Act as a Senior LinkedIn Profile Expert. Rewrite this About section to be engaging, professional, and detailed. Use 3-4 paragraphs.",
        experience: "Act as a Resume Writer. Rewrite these experience details to be high-impact, using keywords and active verbs. Return 3 distinct versions.",
        skills: "Suggest 6 trending LinkedIn skills based on the current profile. Return a comma-separated list.",
        banner: "Generate 3 short, punchy, professional taglines (under 5 words) for a LinkedIn Banner based on this role. Return only the 3 lines.",
        photo: "Generate a professional headshot description for this user. Lighting: Studio. Background: Office Blur. Style: Corporate."
    }
};

// --- Helper: Read/Write Config ---
function getConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
        return DEFAULT_CONFIG;
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
}

function saveConfig(newConfig) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
}

// --- Admin API ---
app.get('/api/admin/config', (req, res) => {
    res.json(getConfig());
});

app.post('/api/admin/config', (req, res) => {
    const newConfig = req.body;
    saveConfig(newConfig);
    res.json({ success: true, message: "Configuration Saved!" });
});

// --- Extension Proxy APIs ---

// 1. Get Prompts (Extension fetches defaults from here)
app.get('/api/prompts', (req, res) => {
    const config = getConfig();
    res.json(config.prompts);
});

// 2. Generate Text (Gemini Proxy)
app.post('/api/generate-content', async (req, res) => {
    const { prompt } = req.body;
    const config = getConfig();

    if (!config.geminiKey) return res.status(500).json({ error: "Server Gemini Key not configured" });

    try {
        // Simple Gemini 1.5 Flash Call
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiKey}`;
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: prompt }] }]
        });
        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        res.json({ text });
    } catch (error) {
        console.error("Gemini Error:", error.response?.data || error.message);
        res.status(500).json({ error: "AI Generation Failed" });
    }
});

// 3. Generate Image (OpenAI Proxy)
app.post('/api/generate-image', async (req, res) => {
    const { prompt } = req.body;
    const config = getConfig();

    if (!config.openaiKey) return res.status(500).json({ error: "Server OpenAI Key not configured" });

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/images/generations',
            {
                model: "dall-e-3",
                prompt: "Professional LinkedIn Banner: " + prompt,
                n: 1,
                size: "1024x1024"
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.openaiKey}`
                }
            }
        );
        res.json({ imageUrl: response.data.data[0].url });
    } catch (error) {
        console.error("OpenAI Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Image Generation Failed" });
    }
});

app.listen(PORT, () => {
    console.log(`Backend Server running on http://localhost:${PORT}`);
    console.log(`Admin Panel available at http://localhost:${PORT}`);
});
