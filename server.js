require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { LumaAI } = require('lumaai');
const Groq = require('groq-sdk');
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');

// Initialize Express app and constants
const app = express();
const PORT = 5007;

// Middleware with increased limits
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Environment variables check
const requiredEnvVars = {
    LUMAAI_API_KEY: process.env.LUMAAI_API_KEY,
    IMGUR_CLIENT_ID: process.env.IMGUR_CLIENT_ID, 
    GROQ_API_KEY: process.env.GROQ_API_KEY
};

Object.entries(requiredEnvVars).forEach(([key, value]) => {
    if (!value) console.error(`${key} is not set in environment variables`);
});

// Initialize clients
const client = new LumaAI({ authToken: process.env.LUMAAI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Utility Functions for Image Handling (unchanged)
async function uploadImageToImgur(base64Image) {
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const formData = new FormData();
    formData.append('image', base64Data);
    formData.append('type', 'base64');
    try {
        const response = await axios.post('https://api.imgur.com/3/image', formData, {
            headers: {
                Authorization: `Client-ID ${requiredEnvVars.IMGUR_CLIENT_ID}`,
                ...formData.getHeaders()
            }
        });
        if (!response.data?.data?.link) {
            throw new Error('Failed to retrieve image URL from Imgur');
        }
        return response.data.data.link;
    } catch (error) {
        throw new Error(`Imgur upload failed: ${error.message}`);
    }
}

async function generateImageDescription(imageUrl) {
    const requestBody = {
        messages: [{
            role: "user",
            content: [
                { type: "text", text: "What's in this image?" },
                { type: "image_url", image_url: { url: imageUrl } }
            ]
        }],
        model: "llama-3.2-11b-vision-preview",
        temperature: 0.7,
        max_completion_tokens: 1024,
        top_p: 1,
        stream: false
    };
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', requestBody, {
            headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.data?.choices?.[0]?.message?.content) {
            throw new Error('No description generated from Groq API');
        }
        return response.data.choices[0].message.content;
    } catch (error) {
        throw new Error(`Groq API error: ${error.message}`);
    }
}

async function validateAndOptimizeImage(base64Image) {
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    try {
        const optimizedBuffer = await sharp(buffer)
            .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
        return optimizedBuffer.toString('base64');
    } catch (error) {
        throw new Error('Image optimization failed');
    }
}

// Existing endpoint for image upload and description generation
app.post('/upload-and-generate-description', async (req, res) => {
    const { image } = req.body;
    if (!image || !image.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Valid base64 image data is required' });
    }
    try {
        const optimizedImage = await validateAndOptimizeImage(image);
        const imageUrl = await uploadImageToImgur(optimizedImage);
        const description = await generateImageDescription(imageUrl);
        res.json({ description });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// NEW: Endpoint to start video generation via LumaAI
app.post('/generate-video', async (req, res) => {
    try {
        const { prompt, model = 'ray-2' } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        console.log('Received video generation request:', { prompt, model });
        // Create video generation request using LumaAI's API
        const generation = await client.generations.create({
            prompt,
            model,
            resolution: "720p", // Adjust resolution as needed
            duration: "5s"      // Adjust duration as needed
        });
        console.log('Video generation started:', generation);
        res.json({ generationId: generation.id, state: generation.state });
    } catch (error) {
        console.error('Error generating video:', error);
        res.status(500).json({ error: error.message });
    }
});

// NEW: Endpoint to poll the status of video generation
app.get('/video-status/:generationId', async (req, res) => {
    try {
        const { generationId } = req.params;
        if (!generationId) {
            return res.status(400).json({ error: 'Generation ID is required' });
        }
        const status = await client.generations.get(generationId);
        console.log('Checked video generation status:', status);
        res.json({
            state: status.state,
            completed: status.state === 'completed',
            videoUrl: status.assets && status.assets.video ? status.assets.video : null,
        });
    } catch (error) {
        console.error('Error checking video status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
