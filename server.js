require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { LumaAI } = require('lumaai');
const Groq = require('groq-sdk');
const axios = require('axios');
const fs = require("fs");

// Initialize Express app and constants
const app = express();
const PORT = 5002;

console.log('Starting server initialization...');

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


async function generateImageDescriptionFromBase64(base64Image) {
    try {
        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Describe the following image in detail." },
                            { 
                                type: "image_url", 
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                } 
                            }
                        ]
                    }
                ]
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

       // console.log("Groq API Response:", JSON.stringify(response.data, null, 2));
        return response.data.choices[0]?.message?.content || "No description available.";
    } catch (error) {
        console.error("Error calling Groq API:", error.response?.data || error.message);
        return "Error generating image description.";
    }
}


// Function to enhance short prompts
function enhancePrompt(prompt) {
    // If prompt is already detailed (longer than 30 chars), return as is
    if (prompt.length > 30) return prompt;
    
    // Dictionary of basic enhancements for common subjects
    const enhancementMap = {
        'oranges': 'Fresh, juicy oranges arranged on a wooden table with sunlight streaming through a window, creating a warm glow on the citrus fruits',
        'beach': 'A serene beach scene with gentle waves washing onto golden sand, palm trees swaying in the breeze, and a beautiful sunset on the horizon',
        'city': 'A modern city skyline at dusk with lights beginning to twinkle in skyscrapers, busy streets below, and a colorful sky transition',
        'forest': 'A lush, green forest with sunbeams filtering through tall trees, moss-covered stones, and a gentle stream flowing over rocks',
        'mountains': 'Majestic snow-capped mountains under a clear blue sky, with a winding path leading through alpine meadows filled with wildflowers'
    };
    
    // Check if we have a specific enhancement for this prompt
    if (enhancementMap[prompt.toLowerCase()]) {
        console.log(`Enhanced prompt from "${prompt}" to a detailed description`);
        return enhancementMap[prompt.toLowerCase()];
    }
    
    // Generic enhancement for other short prompts
    const enhancedPrompt = `A cinematic, detailed view of ${prompt} with beautiful lighting, rich textures, and vibrant colors in a natural setting`;
    console.log(`Generic enhancement of prompt from "${prompt}" to "${enhancedPrompt}"`);
    return enhancedPrompt;
}

app.post('/upload-and-generate-description', async (req, res) => {
    const { image } = req.body;
    
    // Ensure image is provided in base64 format
    if (!image || !image.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Valid base64 image data is required' });
    }
    
    try {
        const base64Image = image.split(',')[1];
        // Generate the description
        const description = await generateImageDescriptionFromBase64(base64Image);
        
        // Define the webhook payload with the description
        const payload = {
            description,
            timestamp: new Date().toISOString()
        };

        // // Send the payload to the webhook
        // await axios.post("https://hvadss.app.n8n.cloud/webhook-test/63d4237e-374b-4319-b0da-49f09119c1b1", payload, {
        //     headers: { "Content-Type": "application/json" }
        // });

        // Return the description to the frontend
        res.json({ description });
    } catch (error) {
        console.error("Error processing image:", error.response?.data || error.message);
        res.status(500).json({ error: error.message });
    }
});







// FIXED: Improved endpoint to start video generation via LumaAI
app.post('/generate-video', async (req, res) => {
    try {
        let { prompt, model = 'ray-2', negative_prompt = '', resolution = "4k", duration = "5s" } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        
        // Validate and enhance prompt if needed
        if (prompt.trim().length < 10) {
            const originalPrompt = prompt;
            prompt = enhancePrompt(prompt);
            console.log(`Prompt enhanced from "${originalPrompt}" to "${prompt}"`);
        }
        
        console.log('Video generation request:', { 
            prompt: prompt.substring(0, 50) + (prompt.length > 50 ? '...' : ''),
            model, 
            resolution,
            duration
        });
        
        // Create video generation request with complete parameters
        const generationParams = {
            prompt,
            model,
            resolution,
            duration
        };
        
        // Add negative prompt if provided
        if (negative_prompt && negative_prompt.trim().length > 0) {
            generationParams.negative_prompt = negative_prompt;
        }
        
        console.log('Sending request to LumaAI with params:', generationParams);
        
        // Make the API request
        const generation = await client.generations.create(generationParams);
        
        console.log('Video generation started:', {
            id: generation.id,
            state: generation.state,
            model: generation.model,
            created_at: generation.created_at
        });
        
        res.json({ 
            generationId: generation.id, 
            state: generation.state,
            prompt: prompt,
            model: generation.model
        });
    } catch (error) {
        console.error('Error generating video:', error);
        
        // Improved error handling
        let errorMessage = error.message;
        let errorDetails = {};
        
        // Extract API error details if available
        if (error.error && typeof error.error === 'object') {
            errorDetails = error.error;
        }
        
        // Suggest solutions based on error type
        let suggestion = '';
        if (errorMessage.includes('Invalid request')) {
            suggestion = 'Try using a more detailed prompt (at least 10-15 words describing the scene in detail)';
        } else if (errorMessage.includes('rate limit')) {
            suggestion = 'You may have hit API rate limits. Wait a few minutes before trying again.';
        } else if (errorMessage.includes('unauthorized')) {
            suggestion = 'Check your LUMAAI_API_KEY environment variable.';
        }
        
        res.status(500).json({ 
            error: errorMessage,
            details: errorDetails,
            suggestion: suggestion || 'Check LumaAI documentation for proper request format'
        });
    }
});



// Enhanced endpoint to poll the status of video generation
app.get('/video-status/:generationId', async (req, res) => {
    try {
        const { generationId } = req.params;
        if (!generationId) {
            return res.status(400).json({ error: 'Generation ID is required' });
        }
        
        console.log(`Checking status for video generation ID: ${generationId}`);
        const status = await client.generations.get(generationId);
        
        // Log based on state
        const stateEmoji = {
            'pending': '⏳',
            'processing': '🔄',
            'completed': '✅',
            'failed': '❌'
        };
        
        const emoji = stateEmoji[status.state] || '❓';
        console.log(`${emoji} Video status [${generationId}]: ${status.state}`);
        
        if (status.state === 'completed') {
            console.log(`Video available at: ${status.assets?.video || 'URL not available'}`);
        } else if (status.state === 'failed') {
            console.error(`Generation failed: ${status.failure_reason || 'Unknown reason'}`);
        }
        
        // Return enhanced status information
        res.json({
            state: status.state,
            completed: status.state === 'completed',
            videoUrl: status.assets && status.assets.video ? status.assets.video : null,
            progress: status.progress || null,
            failureReason: status.failure_reason || null,
            model: status.model,
            createdAt: status.created_at,
            updatedAt: status.updated_at
        });
    } catch (error) {
        console.error('Error checking video status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Video generation endpoint available at: http://localhost:${PORT}/generate-video`);
    console.log(`Status checking endpoint: http://localhost:${PORT}/video-status/:generationId`);
});
