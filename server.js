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
        headline: "Act as a Personal Branding Expert. Write 3 distinct LinkedIn headlines (under 220 chars). \nStyle 1: The Hook (Focus on unique value). \nStyle 2: The Achievement (Metrics focused). \nStyle 3: The Minimalist (Role | Impact). \nRules: No buzzwords (e.g., 'Seasoned', 'Passionate'). Use active voice. Make it sound like a human expert wrote it, not an AI.",
        about: "Act as a Ghostwriter for a Top Executive. Rewrite the 'About' section in the First Person ('I'). \nStructure: \n1. The Hook (Who I am & What drives me). \n2. The Journey (Key pivots/wins). \n3. The Future (What I'm solving now). \nTone: Conversational, confident, but humble. \nCrucial: Avoid corporate fluff like 'synergy', 'spearheaded', 'track record'. Write as if speaking to a peer over coffee.",
        experience: "Act as a Resume Strategist. Rewrite these experience bullets to focus on *Impact* over *Duties*. \n- Use the 'Google XYZ Formula' (Accomplished [X] as measured by [Y], by doing [Z]). \n- Start every bullet with a strong power verb (e.g., Engineered, Scaled, Led). \n- Remove passive language. Make it sound punchy and results-driven.",
        skills: "Analyze the profile and suggest 6 high-value, modern skills. \n- Mix hard skills (tech/tools) and soft skills (leadership/strategy). \n- Avoid generic skills like 'Hard Worker' or 'Microsoft Word'. \n- Focus on skills that recruiters are currently searching for in this industry.",
        banner: "Imagine you are an Art Director. Create 3 concepts for a LinkedIn Banner text overlay. \n- Keep it under 5 words. \n- Style: Clean, Modern, Minimalist. \n- Focus: Personal Brand Statement. \n- Example: 'Designing the Future of FinTech' or 'Scale. Automate. Grow.'",
        photo: "Act as a Professional Photographer. Suggest 3 Headshot Concepts for this user: \n1. Power Look: Professional Dark Blue Blazer, White Shirt, Dark Background. \n2. Modern Approach: Professional Light Gray Blazer. \n3. Minimalist: White Shirt with Dark Background. \nFor each, describe the Pose, Lighting (Studio), and Expression."
    }
};

// --- Helper: Read Config (Checking ENV first for Cloud Deploy) ---
function getConfig() {
    // If running in cloud (Render), use Environment Variables
    if (process.env.GEMINI_API_KEY) {
        return {
            geminiKey: process.env.GEMINI_API_KEY,
            openaiKey: process.env.OPENAI_API_KEY || "",
            prompts: DEFAULT_CONFIG.prompts // Use defaults unless overridden (could be extended)
        };
    }

    // Fallback to local file for development
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
    // Return full URLs
    // Use 127.0.0.1 for consistency with extension permissions
    const bannerUrls = files.map(file => `http://127.0.0.1:3000/banners/${file}`);
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
