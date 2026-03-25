require('dotenv').config(); // Load .env file if present
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

// Ensure data directory exists if we need to write to it locally
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Support large image uploads
app.use(express.static('public'));

// Default Configuration
const DEFAULT_CONFIG = {
    geminiKey: "",
    openaiKey: "",
    prompts: {
        headline: `You are an expert LinkedIn branding strategist. Based on the user’s input, generate a professional LinkedIn headline.
Rules:
1. Summarize professional experience, areas of expertise, and distinctive value in one headline (max 220 characters).
2. Integrate relevant industry keywords to enhance search visibility and SEO.
3. Highlight expertise, impact, or purpose in a compelling, credible tone.
4. Avoid first-person language (no “I,” “me,” or “my”).
Restrictions: Do NOT use phrases like "Stakeholder", "Collaborative", "Result-oriented", "Passionate about", "Proven track record", "Thriver", "Game-changer".
Style: Concise, authentic, and engaging.`,

        about: `You are an expert LinkedIn profile writer. Based on the user’s input, craft a polished and compelling "About Me" summary.
Structure:
1. Storytelling-style, professional yet engaging. Length: up to 2,200 characters.
2. No fake numbers — only use actual data from input.
3. Format:
   - Career overview (experience & industries)
   - Current role & leadership scope
   - 6 crisp pointers (🔹 bullets) covering major achievements
   - Endnote / call-to-action (forward-looking).
Restrictions: Do NOT use phrases like "Stakeholder", "Cross-functional", "Result-driven", "Detail-oriented", "Passionate about", "Proactive".
Formatting Rules: Do NOT start with a title or heading line (e.g., **Title Here** or "Crafting Experiences"). Start DIRECTLY with the first paragraph of the career overview. Do NOT use Markdown headings (no #, ##, ### symbols). Do NOT use asterisks for bold (**text**). Use plain text only. LinkedIn does not render Markdown.
Style: Human-written, natural rhythm, elevated yet accessible language.`,

        experience: `You are an expert LinkedIn profile writer. Based on the user’s provided work experience, rewrite the job description.
Structure:
1. Profile Summary: Start with “As a [Position Name] at [Company Name], …” (Limit to 4 lines).
2. Key Highlights: Provide 5–6 concise bullet points using varied action verbs.
3. Skills Section: At the end, provide exactly 5 relevant skills in a single row, separated by commas.
Restrictions: Do NOT use "Stakeholder", "Collaborative", "Streamline", "Result-oriented", "Proven track record".
Formatting Rules: Do NOT start with conversational fillers like "Here is the generated content" or "Okay, here is". Start DIRECTLY with the Profile Summary. Do NOT use Markdown asterisks for bolding (**text**). Output ONLY the rewritten job description.
Style: Varied action verbs, quantifiable results if available, SEO-friendly.`,

        skills: `You are an expert LinkedIn profile strategist. Based on the user's profile, generate a list of 20–25 highly relevant and SEO-optimized skills.
Rules:
1. Only include skills that accurately reflect the individual’s expertise.
2. Incorporate high-ranking industry keywords.
Restrictions: Do NOT include filler words or clichés (e.g., stakeholder management, cross-functional collaboration, detail-oriented, result-driven).
Output Format: Present the skills in a single-row format, separated by commas. Do not number or bullet the list.`
    }
};

// --- Helper: Read Config (Checking ENV first for Cloud Deploy) ---
function getConfig() {
    let config = DEFAULT_CONFIG;

    // 1. Load from file if exists (Prompts preservation)
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const fileData = fs.readFileSync(CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(fileData);
            config = { ...config, ...parsed };
        } catch (e) {
            console.error("Config Parsing Error:", e);
        }
    }

    // 2. Override with Environment Variables (Security Priority)
    if (process.env.GEMINI_API_KEY) {
        config.geminiKey = process.env.GEMINI_API_KEY;
    }
    if (process.env.OPENAI_API_KEY) {
        config.openaiKey = process.env.OPENAI_API_KEY;
    }

    return config;
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

// 1.5 Verify License (Backend Check)
app.post('/api/verify-license', (req, res) => {
    const { licenseKey } = req.body;

    // MASTER KEYS for Reviewers / Admins
    const MASTER_KEYS = ["PRO-TEST-REVIEW", "PRO-ADMIN-ACCESS", "PRO-DEMO"];

    if (!licenseKey) {
        return res.json({ valid: false, message: "No key provided" });
    }

    // 1. Check Master Keys
    if (MASTER_KEYS.includes(licenseKey)) {
        return res.json({ valid: true, plan: "Pro (Reviewer)" });
    }

    // 2. Default Pattern Check (Temporary until real DB)
    // Accept any key starting with "PRO-" that is at least 8 chars long
    if (licenseKey.startsWith("PRO-") && licenseKey.length >= 8) {
        return res.json({ valid: true, plan: "Pro (Standard)" });
    }

    return res.json({ valid: false, message: "Invalid License Key" });
});

// 1.1 Get List of Available Banners (Backend Files)
app.get('/api/banners', (req, res) => {
    const bannerDir = path.join(__dirname, 'public', 'banners');
    if (!fs.existsSync(bannerDir)) {
        return res.json([]);
    }
    const files = fs.readdirSync(bannerDir).filter(file => {
        return ['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(path.extname(file).toLowerCase());
    });

    // Return full URLs using the dynamic host
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const bannerUrls = files.map(file => `${protocol}://${host}/banners/${file}`);

    res.json(bannerUrls);
});

// 2. Generate Text (Gemini Proxy)
app.post('/api/generate-content', async (req, res) => {
    const { prompt } = req.body;
    const config = getConfig();

    if (!config.geminiKey) return res.status(500).json({ error: "Server Gemini Key not configured" });

    try {
        // Gemini 2.0 Flash (Stable)
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.geminiKey}`;

        const parts = [{ text: String(prompt || "") }];

        // Handle Multimodal Input (Image)
        if (req.body.image) {
            // Remove data URI prefix if present
            const base64Image = req.body.image.includes('base64,')
                ? req.body.image.split('base64,')[1]
                : req.body.image;

            parts.push({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Image
                }
            });
        }

        const payload = { contents: [{ parts }] };
        console.log("Sending Payload to Gemini Text. Image:", req.body.image ? "YES" : "NO");

        const response = await axios.post(url, payload);
        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        res.json({ text });
    } catch (error) {
        console.error("Gemini Text Error:", error.response?.data || error.message);
        res.status(500).json({
            error: "AI Generation Failed",
            details: error.response?.data || error.message
        });
    }
});

// 3. Generate Image (Gemini Imagen Proxy)
app.post('/api/generate-image', async (req, res) => {
    const { prompt } = req.body;
    const config = getConfig();

    // Use Gemini Key for Images too!
    if (!config.geminiKey) return res.status(500).json({ error: "Server Gemini Key not configured" });

    // DEBUG: Log Body to see why prompt is undefined
    console.log("Image Gen Request Body:", JSON.stringify(req.body));
    if (!prompt) return res.status(400).json({ error: "Missing 'prompt' in request body" });

    try {
        // PAID TIER: Use Imagen 4.0 (Available in list)
        // Method: predict
        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${config.geminiKey}`;

        const { aspectRatio = "1:1", style = "photorealistic" } = req.body;

        // Clean prompt construction
        const finalPrompt = prompt.includes("Banner") ? prompt : `${prompt}, ${style}, high quality, 8k, highly detailed`;

        // Payload Construction
        const instance = { prompt: finalPrompt };
        let useImage = false;

        // Handle Image-to-Image (Identity Retention)
        if (req.body.image) {
            const base64Image = req.body.image.includes('base64,')
                ? req.body.image.split('base64,')[1]
                : req.body.image;

            instance.image = { bytesBase64Encoded: base64Image };
            useImage = true;
            console.log("Attempting Image-to-Image with Imagen 4.0...");
        }

        try {
            const response = await axios.post(url, {
                instances: [instance],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: aspectRatio
                }
            });

            // DEBUGGING: Log full response
            console.log("Gemini Response:", JSON.stringify(response.data, null, 2));

            // Imagen returns Base64 in bytesBase64Encoded
            const b64 = response.data?.predictions?.[0]?.bytesBase64Encoded;
            if (!b64) throw new Error("No image data in response.");

            const imageUrl = `data:image/jpeg;base64,${b64}`;
            res.json({ imageUrl });

        } catch (innerError) {
            console.log("Inner Error Status:", innerError.response?.status);
            console.log("Use Image Flag:", useImage);

            // Check for 400 Bad Request (likely Image not supported)
            // Also check if the error message specifically mentions "Image in input"
            const isImageError = innerError.response?.data?.error?.message?.includes("Image in input");

            // Log detailed Google Error
            console.error("Google API detailed error:", JSON.stringify(innerError.response?.data, null, 2));

            // FALLBACK: If Image-to-Image fails (e.g. 400 Invalid Argument), retry without image
            if (useImage && (innerError.response?.status === 400 || isImageError)) {
                console.warn("Image-to-Image failed (Model may not support it). Falling back to Text-to-Image...");

                try {
                    // Retry with Text Only
                    delete instance.image;
                    const retryResponse = await axios.post(url, {
                        instances: [instance],
                        parameters: {
                            sampleCount: 1,
                            aspectRatio: aspectRatio
                        }
                    });

                    const b64 = retryResponse.data?.predictions?.[0]?.bytesBase64Encoded;
                    if (!b64) throw new Error("No image data in fallback response.");

                    const imageUrl = `data:image/jpeg;base64,${b64}`;
                    res.json({ imageUrl });
                    return;
                } catch (retryError) {
                    console.error("Fallback Text-to-Image ALSO failed:", retryError.message);
                    throw retryError; // Throw the retry error to be caught by outer catch
                }
            }
            throw innerError; // Re-throw if it wasn't a recoverable 400
        }

    } catch (error) {
        const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        console.error("Gemini Image Error:", errorMsg);
        fs.writeFileSync(path.join(__dirname, 'server_debug.log'), `[${new Date().toISOString()}] Error: ${errorMsg}\n`, { flag: 'a' });

        res.status(500).json({
            error: "Image Gen Failed",
            details: error.response?.data || error.message
        });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend Server running on port ${PORT}`);
    console.log(`Admin/API available.`);
});
