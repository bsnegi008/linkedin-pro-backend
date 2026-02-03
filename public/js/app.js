const CONFIG_API = '/api/admin/config';

// UI Elements
const els = {
    geminiKey: document.getElementById('geminiKey'),
    openaiKey: document.getElementById('openaiKey'),
    prompts: {
        headline: document.getElementById('prompt-headline'),
        about: document.getElementById('prompt-about'),
        experience: document.getElementById('prompt-experience'),
        skills: document.getElementById('prompt-skills'),
        banner: document.getElementById('prompt-banner'),
        photo: document.getElementById('prompt-photo')
    },
    saveBtn: document.getElementById('saveBtn'),
    statusMsg: document.getElementById('statusMsg')
};

// 1. Load Configuration
async function loadConfig() {
    try {
        const res = await fetch(CONFIG_API);
        const config = await res.json();

        // Populate Keys
        if (config.geminiKey) els.geminiKey.value = config.geminiKey;
        if (config.openaiKey) els.openaiKey.value = config.openaiKey;

        // Populate Prompts
        Object.keys(els.prompts).forEach(key => {
            if (config.prompts && config.prompts[key]) {
                els.prompts[key].value = config.prompts[key];
            }
        });

    } catch (err) {
        console.error("Load Failed", err);
        showStatus("❌ Failed to load configuration.", "red");
    }
}

// 2. Save Configuration
async function saveConfig() {
    const newConfig = {
        geminiKey: els.geminiKey.value,
        openaiKey: els.openaiKey.value,
        prompts: {}
    };

    Object.keys(els.prompts).forEach(key => {
        newConfig.prompts[key] = els.prompts[key].value;
    });

    try {
        els.saveBtn.disabled = true;
        els.saveBtn.innerText = "Saving...";

        const res = await fetch(CONFIG_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newConfig)
        });

        if (res.ok) {
            showStatus("✅ Configuration Saved Successfully!", "green");
        } else {
            throw new Error("Save returned bad status");
        }
    } catch (err) {
        console.error("Save Failed", err);
        showStatus("❌ Failed to save configuration.", "red");
    } finally {
        els.saveBtn.disabled = false;
        els.saveBtn.innerText = "Save Configuration";
    }
}

function showStatus(msg, color) {
    els.statusMsg.innerText = msg;
    els.statusMsg.style.color = color;
    setTimeout(() => {
        els.statusMsg.innerText = "";
    }, 3000);
}

// Init
els.saveBtn.addEventListener('click', saveConfig);
loadConfig();
