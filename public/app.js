marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
        return hljs.highlightAuto(code).value;
    }
});

let allSessions = [];
let currentSessionId = Date.now();
let chatHistory = [];
let uploadedImage = null;
let isGenerating = false;
let abortController = null;

// Load History & Migrate old single-chat to multi-chat system
try {
    allSessions = JSON.parse(localStorage.getItem('novahSessions')) || [];
    let oldHistory = JSON.parse(localStorage.getItem('novahChatHistory'));
    if (oldHistory && oldHistory.length > 0 && allSessions.length === 0) {
        allSessions.push({ id: Date.now(), title: "Previous Chat", messages: oldHistory });
        localStorage.setItem('novahSessions', JSON.stringify(allSessions));
        localStorage.removeItem('novahChatHistory');
    }
} catch (e) { allSessions = []; }

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('apiKey').value = localStorage.getItem('novahApiKey') || '';
    document.getElementById('modelName').value = localStorage.getItem('novahModel') || 'gemini-2.5-flash';
    document.getElementById('systemInstruction').value = localStorage.getItem('novahSystem') || '';
    
    // Always start on a fresh chat
    startNewChat();
    updateHistoryList();

    // Image Upload Logic
    document.getElementById('imageUpload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                uploadedImage = canvas.toDataURL('image/jpeg', 0.8);
                
                document.getElementById('imagePreview').src = uploadedImage;
                document.getElementById('imagePreviewContainer').style.display = 'block';
                document.querySelector('.attach-btn').style.color = '#8ab4f8';
            }
            img.src = event.target.result;
        }
        reader.readAsDataURL(file);
    });
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

// Sidebar History Management
function startNewChat() {
    currentSessionId = Date.now();
    chatHistory = [];
    document.getElementById('chatBox').innerHTML = '';
    document.getElementById('chatBox').style.display = 'none';
    document.getElementById('welcomeScreen').style.display = 'flex';
    document.getElementById('sidebar').classList.remove('open');
}

function loadSession(id) {
    const session = allSessions.find(s => s.id === id);
    if (!session) return;
    currentSessionId = session.id;
    chatHistory = session.messages;
    
    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('chatBox').style.display = 'block';
    
    renderHistory();
    toggleSidebar();
}

function updateHistoryList() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    
    // Sort so newest is at the top
    const sortedSessions = [...allSessions].sort((a, b) => b.id - a.id);
    
    sortedSessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerText = "💬 " + session.title;
        item.onclick = () => loadSession(session.id);
        list.appendChild(item);
    });
}

function clearAllHistory() {
    allSessions = [];
    localStorage.removeItem('novahSessions');
    updateHistoryList();
    startNewChat();
    closeSettings();
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
    // If AI is typing, this button acts as a STOP button
    if (isGenerating) {
        if (abortController) abortController.abort();
        return;
    }

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
    
    // Save to multi-session storage
    let sessionIndex = allSessions.findIndex(s => s.id === currentSessionId);
    if (sessionIndex === -1) {
        let titleText = typeof messageContent === 'string' ? messageContent : (messageContent[0]?.text || "Image Attached");
        allSessions.push({ id: currentSessionId, title: titleText.substring(0, 25) + '...', messages: chatHistory });
    } else {
        allSessions[sessionIndex].messages = chatHistory;
    }
    try { localStorage.setItem('novahSessions', JSON.stringify(allSessions)); } catch(e) {}
    updateHistoryList();

    appendMessageUI('user', messageContent, true);
    
    input.value = '';
    removeImage();
    
    const aiMessageDiv = appendMessageUI('ai', '', true);

    // Toggle Send Button to Stop Button
    isGenerating = true;
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.classList.add('stop');
    sendBtn.innerHTML = '<span class="material-icons-round" style="font-size: 20px;">stop</span>';

    let apiMessages = [...chatHistory];
    if (systemInstruction) apiMessages.unshift({ role: "system", content: systemInstruction });

    abortController = new AbortController();
    let aiFullText = "";
    let isThinking = false;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: apiMessages, apiKey, model }),
            signal: abortController.signal
        });

        if (!response.ok) throw new Error("API Error");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const data = JSON.parse(line.slice(6));
                        const delta = data.choices[0].delta;
                        
                        // Catch the hidden thought process
                        if (delta.reasoning_content) {
                            if (!isThinking) {
                                isThinking = true;
                                aiFullText += '<details class="thought-process"><summary>🧠 Thought Process</summary><div class="thought-content">';
                            }
                            aiFullText += delta.reasoning_content;
                        }
                        
                        // Catch the actual response
                        if (delta.content) {
                            if (isThinking) {
                                isThinking = false;
                                aiFullText += '</div></details>\n\n';
                            }
                            aiFullText += delta.content;
                        }
                        
                        // Auto-close tags temporarily so markdown doesn't break while streaming
                        let displayHtml = aiFullText;
                        if (isThinking) displayHtml += '</div></details>';
                        
                        const safeMathText = displayHtml.replace(/\\/g, '\\\\');
                        aiMessageDiv.innerHTML = marked.parse(safeMathText);
                    } catch (e) {}
                }
            }
            window.scrollTo(0, document.body.scrollHeight);
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            if (isThinking) aiFullText += '</div></details>\n\n';
            aiFullText += "\n\n*[Stopped by user]*";
            aiMessageDiv.innerHTML = marked.parse(aiFullText.replace(/\\/g, '\\\\'));
        } else {
            aiMessageDiv.innerHTML = "Error connecting to AI. Please check your API key and model name.";
        }
    } finally {
        // Reset UI and save final response
        isGenerating = false;
        sendBtn.classList.remove('stop');
        sendBtn.innerHTML = '<span class="material-icons-round" style="font-size: 20px; margin-left: 3px;">send</span>';
        
        chatHistory.push({ role: 'assistant', content: aiFullText });
        let sIdx = allSessions.findIndex(s => s.id === currentSessionId);
        if (sIdx > -1) allSessions[sIdx].messages = chatHistory;
        try { localStorage.setItem('novahSessions', JSON.stringify(allSessions)); } catch(e) {}
        
        addCopyButtons();
        if (window.MathJax) MathJax.typesetPromise();
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
        // If loading from history, safely format the math
        const safeText = isNew ? '' : (typeof contentData === 'string' ? contentData.replace(/\\/g, '\\\\') : '');
        contentDiv.innerHTML = isNew ? '<div style="color: #888;">Thinking...</div>' : marked.parse(safeText);
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
