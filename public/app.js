marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
        return hljs.highlightAuto(code).value;
    }
});

let chatHistory = [];
let uploadedImage = null;

// Safely load history to prevent crashes
try {
    chatHistory = JSON.parse(localStorage.getItem('novahChatHistory')) || [];
} catch (e) {
    chatHistory = [];
    localStorage.removeItem('novahChatHistory');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('apiKey').value = localStorage.getItem('novahApiKey') || '';
    document.getElementById('modelName').value = localStorage.getItem('novahModel') || 'gemini-2.5-flash';
    document.getElementById('systemInstruction').value = localStorage.getItem('novahSystem') || '';
    
    // Image Compression & Loading
    document.getElementById('imageUpload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                // Shrink image to prevent QuotaExceededError crash
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleSize;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                uploadedImage = canvas.toDataURL('image/jpeg', 0.8);
                
                // Show preview UI
                document.getElementById('imagePreview').src = uploadedImage;
                document.getElementById('imagePreviewContainer').style.display = 'block';
                document.querySelector('.attach-btn').style.color = '#8ab4f8';
            }
            img.src = event.target.result;
        }
        reader.readAsDataURL(file);
    });

    if (chatHistory.length > 0) {
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('chatBox').style.display = 'block';
        renderHistory();
        updateHistoryList();
    }
});

function removeImage() {
    uploadedImage = null;
    document.getElementById('imageUpload').value = '';
    document.getElementById('imagePreviewContainer').style.display = 'none';
    document.querySelector('.attach-btn').style.color = 'white';
}

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
        item.innerText = "💬 " + (typeof firstMsg.content === 'string' ? firstMsg.content.substring(0, 25) + '...' : 'Image Attached');
        list.appendChild(item);
    }
}

function renderHistory() {
    const chatBox = document.getElementById('chatBox');
    chatBox.innerHTML = '';
    chatHistory.forEach(msg => {
        if (msg.role !== 'system') appendMessageUI(msg.role, msg.content, false);
    });
    if (window.MathJax) MathJax.typesetPromise();
}

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
            { type: "text", text: text || "What is in this image?" },
            { type: "image_url", image_url: { url: uploadedImage } }
        ];
    }

    chatHistory.push({ role: 'user', content: messageContent });
    
    // Safely save history
    try {
        localStorage.setItem('novahChatHistory', JSON.stringify(chatHistory));
    } catch (e) {
        console.warn("History too large to save locally.");
    }
    
    appendMessageUI('user', messageContent, true);
    
    // Reset inputs
    input.value = '';
    removeImage();
    
    const aiMessageDiv = appendMessageUI('ai', '', true);

    let apiMessages = [...chatHistory];
    if (systemInstruction) apiMessages.unshift({ role: "system", content: systemInstruction });

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: apiMessages, apiKey, model })
        });

        if (!response.ok) throw new Error("API Error");

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
        try { localStorage.setItem('novahChatHistory', JSON.stringify(chatHistory)); } catch(e) {}
        updateHistoryList();
        
        addCopyButtons();
        if (window.MathJax) MathJax.typesetPromise();

    } catch (error) {
        aiMessageDiv.innerHTML = "Error connecting to AI. Please check your API key and model name.";
    }
}

function appendMessageUI(role, contentData, isNew) {
    const chatBox = document.getElementById('chatBox');
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const avatar = document.createElement('div');
    if (role === 'user') {
        avatar.className = 'user-avatar';
        avatar.innerHTML = '<span class="material-icons-round" style="font-size: 18px;">person</span>';
    } else {
        avatar.className = 'ai-icon-small';
        avatar.innerHTML = '<span class="material-icons-round" style="font-size: 18px;">auto_awesome</span>';
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    if (role === 'user') {
        if (Array.isArray(contentData)) {
            // Render the attached image in the chat
            contentDiv.innerHTML = `<img src="${contentData[1].image_url.url}" style="max-width: 250px; border-radius: 8px; display: block; margin-bottom: 10px;">` + 
                                   (contentData[0].text || "");
        } else {
            contentDiv.textContent = contentData;
        }
    } else {
        contentDiv.innerHTML = isNew ? '<div style="color: #888;">Thinking...</div>' : marked.parse(contentData);
    }
    
    wrapper.appendChild(avatar);
    wrapper.appendChild(contentDiv);
    chatBox.appendChild(wrapper);
    
    window.scrollTo(0, document.body.scrollHeight);
    if (!isNew && role === 'ai') addCopyButtons();
    return contentDiv;
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
