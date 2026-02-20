// Setup Markdown options with syntax highlighting
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    }
});

let chatHistory = JSON.parse(localStorage.getItem('novahChatHistory')) || [];
let uploadedImage = null;

// Initialize settings and history
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('apiKey').value = localStorage.getItem('novahApiKey') || '';
    document.getElementById('modelName').value = localStorage.getItem('novahModel') || 'meta/llama-3.1-405b-instruct';
    renderHistory();
    
    // Handle Image Upload to Base64
    document.getElementById('imageUpload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onloadend = () => { uploadedImage = reader.result; };
        if (file) reader.readAsDataURL(file);
    });
});

function saveSettings() {
    localStorage.setItem('novahApiKey', document.getElementById('apiKey').value);
    localStorage.setItem('novahModel', document.getElementById('modelName').value);
    alert('Settings Saved!');
}

function clearHistory() {
    localStorage.removeItem('novahChatHistory');
    chatHistory = [];
    document.getElementById('chatBox').innerHTML = '';
}

function renderHistory() {
    const chatBox = document.getElementById('chatBox');
    chatBox.innerHTML = '';
    chatHistory.forEach(msg => {
        if (msg.role !== 'system') appendMessageUI(msg.role, msg.content, false);
    });
    MathJax.typesetPromise();
}

async function sendMessage() {
    const input = document.getElementById('userInput');
    let text = input.value.trim();
    if (!text) return;
    
    const apiKey = localStorage.getItem('novahApiKey');
    const model = localStorage.getItem('novahModel');

    // Handle image + text format
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
    uploadedImage = null; // reset image
    document.getElementById('imageUpload').value = '';

    const aiMessageDiv = appendMessageUI('ai', '', true);
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: chatHistory, apiKey, model })
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
                        
                        // Parse markdown live
                        aiMessageDiv.innerHTML = marked.parse(aiFullText);
                    } catch (e) {}
                }
            }
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        chatHistory.push({ role: 'assistant', content: aiFullText });
        localStorage.setItem('novahChatHistory', JSON.stringify(chatHistory));
        
        // Add Copy Buttons and Render Math
        addCopyButtons();
        MathJax.typesetPromise();

    } catch (error) {
        aiMessageDiv.innerHTML = "Error connecting to server. Check API key.";
    }
}

function appendMessageUI(role, text, isNew) {
    const chatBox = document.getElementById('chatBox');
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    
    if (role === 'user') {
        div.textContent = typeof text === 'string' ? text : "Image + Text sent";
    } else {
        div.innerHTML = isNew ? '' : marked.parse(text);
    }
    
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    if (!isNew && role === 'ai') addCopyButtons();
    return div;
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
