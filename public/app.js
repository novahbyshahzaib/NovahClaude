marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
        return hljs.highlightAuto(code).value;
    }
});

let chatHistory = JSON.parse(localStorage.getItem('novahChatHistory')) || [];
let uploadedImage = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('apiKey').value = localStorage.getItem('novahApiKey') || '';
    document.getElementById('modelName').value = localStorage.getItem('novahModel') || 'gemini-2.5-flash';
    document.getElementById('systemInstruction').value = localStorage.getItem('novahSystem') || '';
    
    document.getElementById('imageUpload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onloadend = () => { 
            uploadedImage = reader.result;
            document.querySelector('.attach-btn').style.background = '#8ab4f8';
        };
        if (file) reader.readAsDataURL(file);
    });

    if (chatHistory.length > 0) {
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('chatBox').style.display = 'block';
        renderHistory();
        updateHistoryList();
    }
});

/* UI Controls */
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function openSettings() { document.getElementById('settingsModal').style.display = 'flex'; toggleSidebar(); }
function closeSettings() { document.getElementById('settingsModal').style.display = 'none'; }
function setInput(text) { document.getElementById('userInput').value = text; }

function saveSettings() {
    localStorage.setItem('novahApiKey', document.getElementById('apiKey').value);
    localStorage.setItem('novahModel', document.getElementById('modelName').value);
    localStorage.setItem('novahSystem', document.getElementById('systemInstruction').value);
    closeSettings();
}

function startNewChat() {
    chatHistory = [];
    localStorage.removeItem('novahChatHistory');
    document.getElementById('chatBox').innerHTML = '';
    document.getElementById('chatBox').style.display = 'none';
    document.getElementById('welcomeScreen').style.display = 'flex';
    toggleSidebar();
}

function clearHistory() { startNewChat(); closeSettings(); }

function updateHistoryList() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    const firstMsg = chatHistory.find(m => m.role === 'user');
    if (firstMsg) {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerText = "💬 " + (typeof firstMsg.content === 'string' ? firstMsg.content.substring(0, 25) + '...' : 'Image Chat');
        list.appendChild(item);
    }
}

function renderHistory() {
    const chatBox = document.getElementById('chatBox');
    chatBox.innerHTML = '';
    chatHistory.forEach(msg => {
        if (msg.role !== 'system') appendMessageUI(msg.role, msg.content, false);
    });
    MathJax.typesetPromise();
}

/* Chat Logic */
async function sendMessage() {
    const input = document.getElementById('userInput');
    let text = input.value.trim();
    if (!text && !uploadedImage) return;

    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('chatBox').style.display = 'block';
    
    const apiKey = localStorage.getItem('novahApiKey');
    const model = localStorage.getItem('novahModel');
    const systemInstruction = localStorage.getItem('novahSystem');

    let messageContent = text;
    if (uploadedImage) {
        messageContent = [
            { type: "text", text: text },
            { type: "image_url", image_url: { url: uploadedImage } }
        ];
    }

    chatHistory.push({ role: 'user', content: messageContent });
    localStorage.setItem('novahChatHistory', JSON.stringify(chatHistory));
    appendMessageUI('user', text, true);
    input.value = '';
    document.querySelector('.attach-btn').style.background = '#333';
    
    const aiMessageDiv = appendMessageUI('ai', '', true);
    uploadedImage = null;
    document.getElementById('imageUpload').value = '';

    // Prep messages array (inject system instruction if exists)
    let apiMessages = [...chatHistory];
    if (systemInstruction) {
        apiMessages.unshift({ role: "system", content: systemInstruction });
    }

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: apiMessages, apiKey, model })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let aiFullText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const data = JSON.parse(line.slice(6));
                        const token = data.choices[0].delta.content || "";
                        aiFullText += token;
                        aiMessageDiv.innerHTML = marked.parse(aiFullText);
                    } catch (e) {}
                }
            }
            window.scrollTo(0, document.body.scrollHeight);
        }

        chatHistory.push({ role: 'assistant', content: aiFullText });
        localStorage.setItem('novahChatHistory', JSON.stringify(chatHistory));
        updateHistoryList();
        
        addCopyButtons();
        MathJax.typesetPromise();

    } catch (error) {
        aiMessageDiv.innerHTML = "Error connecting to AI. Please check settings.";
    }
}

function appendMessageUI(role, text, isNew) {
    const chatBox = document.getElementById('chatBox');
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const avatar = document.createElement('div');
    if (role === 'user') {
        avatar.className = 'user-avatar';
        avatar.innerText = '👤';
    } else {
        avatar.className = 'ai-icon-small';
        avatar.innerText = '✨';
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    
    if (role === 'user') {
        content.textContent = typeof text === 'string' ? text : "Image + Text sent";
    } else {
        content.innerHTML = isNew ? '<div class="typing-indicator">...</div>' : marked.parse(text);
    }
    
    wrapper.appendChild(avatar);
    wrapper.appendChild(content);
    chatBox.appendChild(wrapper);
    
    window.scrollTo(0, document.body.scrollHeight);
    if (!isNew && role === 'ai') addCopyButtons();
    return content;
}

function addCopyButtons() {
    document.querySelectorAll('pre').forEach(block => {
        if (block.querySelector('.copy-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.innerText = 'Copy';
        btn.onclick = () => {
            navigator.clipboard.writeText(block.innerText.replace('Copy', ''));
            btn.innerText = 'Copied!';
            setTimeout(() => btn.innerText = 'Copy', 2000);
        };
        block.appendChild(btn);
    });
}
