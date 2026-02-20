const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allows large image uploads
app.use(express.static('public')); // Serves our frontend files

app.post('/api/chat', async (req, res) => {
    const { messages, apiKey, model } = req.body;

    try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify({
                model: model || "meta/llama-3.1-405b-instruct",
                messages: messages,
                stream: true
            })
        });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value));
        }
        res.end();

    } catch (error) {
        res.status(500).json({ error: 'Failed to connect to AI' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NovahClaude running on port ${PORT}`));
