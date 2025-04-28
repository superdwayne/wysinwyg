require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { LumaAI } = require('lumaai');
const Groq = require('groq-sdk');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

// Initialize Express app and constants
const app = express();
const PORT = process.env.PORT || 5002;
const FALLBACK_PORT = 5003; // Fallback port if primary port is in use

// Create directories for storing images
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'saved_images');

// Create directories if they don't exist
if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// Path for the JSON file to store generated videos
const VIDEOS_JSON_PATH = path.join(__dirname, 'generated_videos.json');

// Initialize videos storage or load existing data
let generatedVideos = [];
try {
    if (fs.existsSync(VIDEOS_JSON_PATH)) {
        const fileData = fs.readFileSync(VIDEOS_JSON_PATH, 'utf8');
        
        if (fileData.trim() !== '') {
            generatedVideos = JSON.parse(fileData);
            
            if (!Array.isArray(generatedVideos)) {
                console.error('Videos JSON file does not contain an array. Starting with an empty array.');
                generatedVideos = [];
            }
        }
    }
} catch (error) {
    console.error(`Error accessing videos file: ${error.message}`);
}

// Helper function to save base64 image to disk and return URL
const saveImageToDisk = (base64Image, generationId) => {
    try {
        // Extract base64 data without the prefix
        const matches = base64Image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            throw new Error('Invalid base64 string');
        }
        
        const type = matches[1];
        const data = matches[2];
        const buffer = Buffer.from(data, 'base64');
        
        // Always use jpg extension for consistency
        const extension = 'jpg';
        
        // Create a unique filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${generationId}_${timestamp}.${extension}`;
        const imagePath = path.join(IMAGES_DIR, filename);
        
        // Make sure the directory exists
        if (!fs.existsSync(IMAGES_DIR)) {
            fs.mkdirSync(IMAGES_DIR, { recursive: true });
        }
        
        const imageUrl = `/saved_images/${filename}`;
        
        // Write the file
        fs.writeFileSync(imagePath, buffer);
        console.log(`Saved image to ${imagePath}`);
        
        return {
            url: imageUrl,
            type: type,
            filename: filename,
            size: buffer.length
        };
    } catch (error) {
        console.error('Error processing image data:', error);
        return null;
    }
};

// Save videos to file
const saveVideosToFile = () => {
    try {
        const dirPath = path.dirname(VIDEOS_JSON_PATH);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        
        const jsonData = JSON.stringify(generatedVideos, null, 2);
        fs.writeFileSync(VIDEOS_JSON_PATH, jsonData);
        return generatedVideos.length;
    } catch (error) {
        console.error('Failed to save videos to file:', error);
        return null;
    }
};

// Sanitize video records by removing any base64 data
const sanitizeVideoRecords = () => {
    let modified = false;
    
    for (let i = 0; i < generatedVideos.length; i++) {
        const video = generatedVideos[i];
        
        // Add default background color if missing
        if (!video.background) {
            video.background = "#f0f4ff";
            modified = true;
        }
        
        // Replace "Demo Client" with "AI ABSTRACTIONS"
        if (video.client === "Demo Client") {
            video.client = "AI ABSTRACTIONS";
            modified = true;
        }
        
        // Ensure ID is present
        if (!video.id) {
            video.id = `generated-${Date.now()}-${i}`;
            modified = true;
        }
        
        // Fix missing prompts by using originalPrompt when available
        if ((video.prompt === "No prompt available" || !video.prompt) && video.originalPrompt) {
            // Use originalPrompt unless it's a base64 image
            if (!video.originalPrompt.startsWith('data:image/')) {
                video.prompt = video.originalPrompt;
                modified = true;
            }
        }
    }
    
    if (modified) {
        saveVideosToFile();
    }
    
    return modified;
};

// Run sanitization during startup
sanitizeVideoRecords();

// Static file serving for saved images
app.use('/saved_images', express.static(IMAGES_DIR));

// Middleware with increased limits
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize clients
let client = null;
let groq = null;

try {
    if (process.env.LUMAAI_API_KEY) {
        client = new LumaAI({ authToken: process.env.LUMAAI_API_KEY });
        console.log('LumaAI client initialized successfully');
    } else {
        console.error('LUMAAI_API_KEY is not set in environment variables');
    }
} catch (error) {
    console.error('Failed to initialize LumaAI client:', error.message);
}

try {
    if (process.env.GROQ_API_KEY) {
        groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        console.log('Groq client initialized successfully');
    } else {
        console.error('GROQ_API_KEY is not set in environment variables');
    }
} catch (error) {
    console.error('Failed to initialize Groq client:', error.message);
}

// Helper function to check if a prompt contains base64 image data
const isBase64ImagePrompt = (prompt) => {
    if (!prompt || typeof prompt !== 'string') return false;
    // Check if it's a proper base64 data URI (not just text mentioning "data:image")
    return prompt.startsWith('data:image/') && prompt.includes(';base64,');
};

async function generateImageDescriptionFromBase64(base64Image) {
    try {
        if (!process.env.GROQ_API_KEY) {
            console.error("Missing GROQ_API_KEY environment variable");
            return "Image description unavailable - GROQ API key is missing.";
        }
        
        // Check if base64Image is valid
        if (!base64Image || typeof base64Image !== 'string') {
            console.error("Invalid base64 image data:", base64Image ? "Non-string data" : "Empty data");
            return "Error: Invalid image data provided";
        }
        
        console.log("Calling Groq API for image description...");
        
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
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log("Groq API response received, status:", response.status);
        
        if (!response.data || !response.data.choices || !response.data.choices[0]) {
            console.error("Unexpected Groq API response format:", response.data);
            return "Error: Unexpected response from description service";
        }
        
        return response.data.choices[0]?.message?.content || "No description available.";
    } catch (error) {
        console.error("Error calling Groq API:", error.message);
        
        // Log more detailed error information
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error("API Error Response Status:", error.response.status);
            console.error("API Error Response Headers:", JSON.stringify(error.response.headers));
            console.error("API Error Response Data:", JSON.stringify(error.response.data));
            return `Error generating image description. API Status: ${error.response.status}. Message: ${error.response.data?.error?.message || "Unknown error"}`;
        } else if (error.request) {
            // The request was made but no response was received
            console.error("No response received:", error.request);
            return "Error: No response received from image description service";
        } else if (error.code === 'ECONNABORTED') {
            return "Error: Request to generate image description timed out.";
        }
        
        return "Error generating image description. Please try again later.";
    }
}

app.post('/upload-and-generate-description', async (req, res) => {
    const { image } = req.body;
    
    // Ensure image is provided in base64 format
    if (!image) {
        console.error("No image provided in request");
        return res.status(400).json({ error: 'Image data is required' });
    }
    
    if (typeof image !== 'string') {
        console.error("Image data is not a string");
        return res.status(400).json({ error: 'Image data must be a string' });
    }
    
    if (!image.startsWith('data:image/')) {
        console.error("Invalid image format, missing data:image/ prefix");
        return res.status(400).json({ error: 'Invalid image format. Must be a base64 data URI with image/ MIME type' });
    }
    
    try {
        console.log('Generating description for uploaded image...');
        
        // Extract the base64 data from the data URI
        const base64Data = image.split(',');
        if (base64Data.length !== 2) {
            console.error("Failed to extract base64 data from image string");
            return res.status(400).json({ error: 'Invalid base64 image format' });
        }
        
        const base64Image = base64Data[1];
        if (!base64Image || base64Image.trim() === '') {
            console.error("Empty base64 image data after splitting");
            return res.status(400).json({ error: 'Empty image data' });
        }
        
        // Generate the description
        const description = await generateImageDescriptionFromBase64(base64Image);
        
        // Check if the description indicates an error
        if (description.startsWith('Error:')) {
            console.error("Error in description generation:", description);
            return res.status(500).json({ error: description });
        }
        
        console.log('Description generated successfully:', 
            description.substring(0, 100) + (description.length > 100 ? '...' : ''));

        // Return the description to the frontend
        res.json({ description });
    } catch (error) {
        console.error("Error processing image:", error.message);
        res.status(500).json({ 
            error: `Failed to process image: ${error.message}`, 
            details: error.stack
        });
    }
});

// Endpoint to start video generation via LumaAI
app.post('/generate-video', async (req, res) => {
    try {
        // Check if LumaAI client is initialized
        if (!client) {
            return res.status(500).json({ 
                error: 'LumaAI client is not initialized', 
                suggestion: 'Check your LUMAAI_API_KEY environment variable.'
            });
        }
        
        let { prompt, model = 'ray-2', negative_prompt = '', resolution = "4k", duration = "5s", image, title, client: clientName, background } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        
        // Validate image if provided
        if (image && !image.startsWith('data:image/')) {
            return res.status(400).json({ error: 'Valid base64 image data is required' });
        }
        
        // Validate and enhance prompt if needed
        if (prompt.trim().length < 10) {
            prompt = enhancePrompt(prompt);
        }
        
        // Validate client name - prevent duplicate "AI Creation"
        if (!clientName || clientName.trim() === "" || clientName.toLowerCase() === "ai creation") {
            // Generate from prompt if possible
            if (prompt && typeof prompt === 'string' && !isBase64ImagePrompt(prompt)) {
                const words = prompt.split(/\s+/).filter(w => w.length > 3);
                if (words.length > 0) {
                    clientName = words.slice(0, Math.min(2, words.length)).join(' ').toUpperCase() + " STUDIOS";
                } else {
                    clientName = "AI ABSTRACTIONS";
                }
            } else {
                clientName = "AI ABSTRACTIONS";
            }
        }
        
        // Create video generation request with parameters
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
        
        // Make the API request
        const generation = await client.generations.create(generationParams);
        
        // Save uploaded image immediately and store metadata
        let savedImageData = null;
        if (image) {
            try {
                // Save the image right away - don't wait for video completion
                savedImageData = saveImageToDisk(image, generation.id);
                console.log(`Pre-emptively saved image for generation ID: ${generation.id}`);
                
                // Create a structure to store image metadata
                const imageData = {
                    title,
                    client: clientName,
                    background,
                    prompt: prompt, // Explicitly store the prompt
                    originalPrompt: prompt, // Keep a backup of the original prompt
                    imageUrl: savedImageData ? savedImageData.url : null,
                    imageSaved: !!savedImageData,
                    timestamp: new Date().toISOString()
                };
                
                // Create global object if it doesn't exist
                if (!global.uploadedImages) {
                    global.uploadedImages = {};
                }
                
                // Store the image metadata
                global.uploadedImages[generation.id] = imageData;
                
                // Also create a preliminary video record to ensure the connection between
                // the image and video is established early
                const prelimVideoRecord = {
                    id: generation.id,
                    url: null, // Will be populated on completion
                    imageUrl: savedImageData ? savedImageData.url : null,
                    title: title || `Untitled-${generation.id.substring(0, 6)}`,
                    client: clientName,
                    background: background || "#f0f4ff",
                    prompt: !isBase64ImagePrompt(prompt) ? prompt : "Image-based prompt",
                    originalPrompt: prompt, // Keep a backup of the original prompt
                    timestamp: new Date().toISOString()
                };
                
                // See if record already exists
                const existingIndex = generatedVideos.findIndex(v => v.id === generation.id);
                if (existingIndex >= 0) {
                    // Update existing record
                    generatedVideos[existingIndex] = {
                        ...generatedVideos[existingIndex],
                        ...prelimVideoRecord
                    };
                } else {
                    // Add new record
                    generatedVideos.push(prelimVideoRecord);
                }
                
                // Save updated videos to JSON file
                saveVideosToFile();
            } catch (saveError) {
                console.error(`Error saving image for generation ${generation.id}:`, saveError);
                // Continue even if image saving fails
            }
        }
        
        // Return a response to the client
        res.json({ 
            generationId: generation.id, 
            id: generation.id,
            state: generation.state,
            prompt: prompt,
            model: generation.model,
            message: 'Video generation started successfully',
            imageUrl: savedImageData ? `http://localhost:${server.address().port}${savedImageData.url}` : null
        });
    } catch (error) {
        console.error('Error generating video:', error);
        
        res.status(500).json({ 
            error: error.message,
            suggestion: 'Check LumaAI documentation for proper request format'
        });
    }
});

app.get('/video-status/:generationId', async (req, res) => {
    try {
        // Check if LumaAI client is initialized
        if (!client) {
            return res.status(500).json({ 
                error: 'LumaAI client is not initialized', 
                suggestion: 'Check your LUMAAI_API_KEY environment variable.'
            });
        }
        
        const { generationId } = req.params;
        if (!generationId) {
            return res.status(400).json({ error: 'Generation ID is required' });
        }
        
        const status = await client.generations.get(generationId);
        
        // Even before completion, try to save image if not already saved
        let imageData = null;
        let imageSavedData = null;
        
        if (global.uploadedImages && global.uploadedImages[generationId]) {
            imageData = global.uploadedImages[generationId];
            
            // Save the image to disk if it exists and hasn't been saved yet
            if (imageData.image && !imageData.imageSaved) {
                try {
                    console.log(`Saving image for generation ID: ${generationId}`);
                    imageSavedData = saveImageToDisk(imageData.image, generationId);
                    
                    // Mark the image as saved and store the URL
                    const { image, ...metadataOnly } = global.uploadedImages[generationId];
                    metadataOnly.imageSaved = true;
                    metadataOnly.imageUrl = imageSavedData ? imageSavedData.url : null;
                    
                    // Save a cleaned prompt if it exists (remove any base64 data)
                    if (metadataOnly.prompt && typeof metadataOnly.prompt === 'string') {
                        if (isBase64ImagePrompt(metadataOnly.prompt)) {
                            metadataOnly.prompt = "Image-based prompt";
                        }
                    }
                    
                    // Replace with the cleaned up metadata
                    global.uploadedImages[generationId] = metadataOnly;
                    
                    console.log(`Saved image to disk for generation ID: ${generationId}`);
                } catch (err) {
                    console.error(`Error saving image for generation ${generationId}:`, err);
                }
            } else if (imageData.imageUrl) {
                // If image was already saved, use the stored URL
                imageSavedData = { url: imageData.imageUrl };
            }
        }
        
        if (status.state === 'completed') {
            // Save video data to our JSON storage
            if (status.assets?.video) {
                // Check if this video is already in our storage
                const existingVideoIndex = generatedVideos.findIndex(v => v.id === generationId);
                
                // Extract proper title and client info
                const title = imageData?.title || `Untitled-${generationId.substring(0, 6)}`;
                
                // If client info exists in imageData, use it; otherwise try to extract from prompt
                let clientName = imageData?.client || "AI ABSTRACTIONS";
                if (!imageData?.client && imageData?.prompt) {
                    // Extract first 2-3 words from prompt for a client-like name
                    const words = imageData.prompt.split(/\s+/).filter(w => w.length > 2);
                    if (words.length > 0) {
                        clientName = words.slice(0, Math.min(3, words.length)).join(' ').toUpperCase();
                    }
                }
                
                // Generate image description if we have an image
                let imageDescription = null;
                if (imageData && imageData.image) {
                    try {
                        const base64Image = imageData.image.split(',')[1];
                        imageDescription = await generateImageDescriptionFromBase64(base64Image);
                    } catch (descError) {
                        console.error(`Error generating image description: ${descError.message}`);
                    }
                } else if (imageData && imageData.prompt && !isBase64ImagePrompt(imageData.prompt)) {
                    // If we don't have the image anymore but have the prompt, use that as the description
                    imageDescription = imageData.prompt;
                }
                
                // If we still don't have a description but have one in an existing record, use that
                if (!imageDescription) {
                    const existingVideo = generatedVideos.find(v => v.id === generationId);
                    if (existingVideo && existingVideo.imageDescription) {
                        imageDescription = existingVideo.imageDescription;
                    } else if (existingVideo && existingVideo.prompt && !isBase64ImagePrompt(existingVideo.prompt)) {
                        imageDescription = existingVideo.prompt;
                    }
                }
                
                // Make sure we have the image URL from earlier saving or from stored data
                const imageUrl = imageSavedData ? imageSavedData.url : 
                                 (imageData && imageData.imageUrl ? imageData.imageUrl : null);
                
                // Create video record with saved image URL
                const videoRecord = {
                    id: generationId,
                    url: status.assets.video,
                    imageUrl: imageUrl,
                    title: title,
                    client: clientName,
                    background: imageData ? imageData.background : null,
                    // Ensure we have the original prompt text
                    prompt: (imageData && imageData.originalPrompt && !isBase64ImagePrompt(imageData.originalPrompt)) ? 
                           imageData.originalPrompt : 
                           (imageData && imageData.prompt ? 
                               (isBase64ImagePrompt(imageData.prompt) ? "Image-based prompt" : imageData.prompt) 
                               : "No prompt available"),
                    imageDescription: imageDescription,
                    timestamp: new Date().toISOString()
                };
                
                if (existingVideoIndex >= 0) {
                    // Update existing record, preserving any existing image URL if new one is null
                    if (!videoRecord.imageUrl && generatedVideos[existingVideoIndex].imageUrl) {
                        videoRecord.imageUrl = generatedVideos[existingVideoIndex].imageUrl;
                    }
                    
                    generatedVideos[existingVideoIndex] = {
                        ...generatedVideos[existingVideoIndex],
                        ...videoRecord
                    };
                } else {
                    // Add new record
                    generatedVideos.push(videoRecord);
                }
                
                // Save the updated videos to file
                saveVideosToFile();
            }
            
            // Get image description
            let imageDesc = null;
            const existingVideo = generatedVideos.find(v => v.id === generationId);
            if (existingVideo && existingVideo.imageDescription) {
                imageDesc = existingVideo.imageDescription;
            }
            
            // Construct absolute image URL if available
            let absoluteImageUrl = null;
            if (imageSavedData && imageSavedData.url) {
                absoluteImageUrl = `http://localhost:${server.address().port}${imageSavedData.url}`;
            } else if (existingVideo && existingVideo.imageUrl && !existingVideo.imageUrl.startsWith('http')) {
                absoluteImageUrl = `http://localhost:${server.address().port}${existingVideo.imageUrl}`;
            } else if (existingVideo && existingVideo.imageUrl) {
                absoluteImageUrl = existingVideo.imageUrl;
            }
            
            // Return video status with image information
            return res.json({
                ...status,
                assets: {
                    ...status.assets || {},
                    // Add image URL to assets
                    image: absoluteImageUrl
                },
                state: status.state,
                id: generationId,
                imageUrl: absoluteImageUrl,
                imageDescription: imageDesc
            });
        } else if (status.state === 'failed') {
            return res.json({
                state: 'failed',
                failure_reason: status.failure_reason || 'Unknown failure reason',
                id: generationId
            });
        }
        
        // For in-progress states, still include image URL if available
        let absoluteImageUrl = null;
        if (imageSavedData && imageSavedData.url) {
            absoluteImageUrl = `http://localhost:${server.address().port}${imageSavedData.url}`;
        } else if (imageData && imageData.imageUrl) {
            absoluteImageUrl = imageData.imageUrl.startsWith('http') 
                ? imageData.imageUrl 
                : `http://localhost:${server.address().port}${imageData.imageUrl}`;
        }
        
        // Return the status info for in-progress states
        res.json({
            ...status,
            id: generationId,
            imageUrl: absoluteImageUrl
        });
    } catch (error) {
        console.error('Error checking video status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get a specific video by ID
app.get('/videos/:id', (req, res) => {
    try {
        const videoId = req.params.id;
        const video = generatedVideos.find(v => v.id === videoId);
        
        if (!video) {
            return res.status(404).json({ error: 'Video not found' });
        }
        
        // Create a clean copy for the response
        const cleanVideo = { ...video };
        
        // Handle imageUrl - ensure it's a proper URL path, not base64 data
        if (cleanVideo.imageUrl) {
            // Remove any base64 data that might have been stored in imageUrl
            if (typeof cleanVideo.imageUrl === 'string' && cleanVideo.imageUrl.includes('data:image')) {
                cleanVideo.imageUrl = null;
            } 
            // Convert relative URL to absolute
            else if (typeof cleanVideo.imageUrl === 'string' && !cleanVideo.imageUrl.startsWith('http')) {
                const port = server.address().port;
                cleanVideo.imageUrl = `http://localhost:${port}${cleanVideo.imageUrl}`;
            }
        }
        
        // Return the sanitized video data
        res.json(cleanVideo);
    } catch (error) {
        console.error('Error getting video:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get all videos
app.get('/videos', (req, res) => {
    try {
        // Filter and sanitize videos before returning them
        const sanitizedVideos = generatedVideos.map(video => {
            // Create a clean copy without modifying the original
            const cleanVideo = { ...video };
            
            // Add isImageOnly flag for frontend to handle differently
            if (cleanVideo.type === 'image') {
                cleanVideo.isImageOnly = true;
            }
            
            // Handle imageUrl - ensure it's a proper URL path, not base64 data
            if (cleanVideo.imageUrl) {
                // Remove any base64 data that might have been stored in imageUrl
                if (typeof cleanVideo.imageUrl === 'string' && cleanVideo.imageUrl.includes('data:image')) {
                    cleanVideo.imageUrl = null;
                } 
                // Convert relative URL to absolute
                else if (typeof cleanVideo.imageUrl === 'string' && !cleanVideo.imageUrl.startsWith('http')) {
                    const port = server.address().port;
                    cleanVideo.imageUrl = `http://localhost:${port}${cleanVideo.imageUrl}`;
                }
            }
            
            return cleanVideo;
        });
        
        res.json(sanitizedVideos);
    } catch (error) {
        console.error('Error getting videos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add config endpoint that returns the current port
app.get('/config', (req, res) => {
    res.json({
        port: server.address().port,
        apiUrl: `http://localhost:${server.address().port}`
    });
});

// Add health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        videoCount: generatedVideos.length,
        videosPath: VIDEOS_JSON_PATH
    });
});

// Endpoint to save an image without generating a video
app.post('/save-image', async (req, res) => {
    try {
        let { prompt, image, title, client: clientName } = req.body;
        
        if (!image) {
            return res.status(400).json({ error: 'Image data is required' });
        }
        
        // Validate image
        if (!image.startsWith('data:image/')) {
            return res.status(400).json({ error: 'Valid base64 image data is required' });
        }
        
        // Generate an ID for this image (similar to how LumaAI would for a video)
        const generationId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        
        // Set default client name if not provided
        if (!clientName || clientName.trim() === "") {
            if (prompt && typeof prompt === 'string') {
                const words = prompt.split(/\s+/).filter(w => w.length > 3);
                if (words.length > 0) {
                    clientName = words.slice(0, Math.min(2, words.length)).join(' ').toUpperCase() + " STUDIOS";
                } else {
                    clientName = "AI ABSTRACTIONS";
                }
            } else {
                clientName = "AI ABSTRACTIONS";
            }
        }
        
        // Save the image
        let savedImageData = null;
        try {
            savedImageData = saveImageToDisk(image, generationId);
            console.log(`Saved image with generation ID: ${generationId}`);
            
            if (!savedImageData) {
                throw new Error('Failed to save image to disk');
            }
            
            // Create an image record
            const imageRecord = {
                id: generationId,
                type: 'image', // Mark this as an image-only record
                url: null, // No video URL for this record
                imageUrl: savedImageData.url,
                title: title || `Image-${generationId.substring(0, 6)}`,
                client: clientName,
                background: "#f0f4ff",
                prompt: prompt || "No prompt available",
                timestamp: new Date().toISOString()
            };
            
            // Add to our storage
            generatedVideos.push(imageRecord);
            
            // Save to JSON file
            saveVideosToFile();
            
            // Return success with the image URL
            res.json({ 
                id: generationId,
                imageUrl: `http://localhost:${server.address().port}${savedImageData.url}`,
                message: 'Image saved successfully'
            });
        } catch (saveError) {
            console.error(`Error saving image ${generationId}:`, saveError);
            return res.status(500).json({ 
                error: `Failed to save image: ${saveError.message}`
            });
        }
    } catch (error) {
        console.error('Error in save-image endpoint:', error);
        res.status(500).json({ 
            error: error.message
        });
    }
});

// Helper function to sanitize prompts for moderation
const sanitizePrompt = (prompt) => {
    if (!prompt) return '';
    
    // Remove potentially problematic terms or phrases
    const sanitized = prompt
        .replace(/weapon|gun|knife|blood|gore|explicit|nude|naked|sexy|violence|violent|kill|killing|murder/gi, '')
        .replace(/  +/g, ' ') // Remove extra spaces
        .trim();
    
    return sanitized || 'A creative digital artwork';
};

// Endpoint to generate an image via LumaAI
app.post('/generate-image', async (req, res) => {
    try {
        // Check if LumaAI client is initialized
        if (!client) {
            return res.status(500).json({ 
                error: 'LumaAI client is not initialized', 
                suggestion: 'Check your LUMAAI_API_KEY environment variable.'
            });
        }
        
        let { prompt, model = 'photon-1', aspect_ratio = '16:9', image, title, client: clientName, background } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        
        // Create image generation request with parameters
        const generationParams = {
            prompt,
            model,
            aspect_ratio
        };
        
        // Add image reference if an image is provided
        if (image && image.startsWith('data:image/')) {
            // Extract the base64 data without the prefix
            const base64Data = image.split(',')[1];
            
            // Basic validation of image size and format
            if (base64Data.length > 10000000) { // Approximately 10MB limit
                return res.status(400).json({ 
                    error: 'Image too large',
                    suggestion: 'Please use an image smaller than 10MB'
                });
            }
            
            // Validate image format - only allow jpeg, png, and webp
            const mimeType = image.match(/data:(image\/[a-z]+);base64,/i)[1];
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType.toLowerCase())) {
                return res.status(400).json({ 
                    error: 'Unsupported image format',
                    suggestion: 'Please use JPEG, PNG, or WebP images only'
                });
            }
            
            // Save the image to get a URL we can reference
            const savedImage = saveImageToDisk(image, `temp-${Date.now()}`);
            
            if (savedImage) {
                // For image reference, we need a publicly accessible URL
                // In a production environment, you would upload this to a CDN
                // For this demo, we'll assume the local server URL is accessible
                const imageUrl = `http://localhost:${server.address().port}${savedImage.url}`;
                
                // Add image_ref to the generation params
                generationParams.image_ref = [
                    {
                        url: imageUrl,
                        weight: 0.85
                    }
                ];
            }
        }
        
        console.log('Starting image generation with params:', JSON.stringify(generationParams));
        
        // Initialize variables for retry logic
        let generation = null;
        let moderationError = null;
        let attempts = 0;
        const maxAttempts = 3;
        
        // Try multiple approaches if needed
        while (attempts < maxAttempts && !generation) {
            try {
                attempts++;
                
                // Modify approach based on attempt number
                if (attempts > 1) {
                    console.log(`Retry attempt ${attempts} with modified parameters`);
                    
                    // First retry: sanitize the prompt
                    if (attempts === 2) {
                        const originalPrompt = generationParams.prompt;
                        generationParams.prompt = sanitizePrompt(originalPrompt);
                        console.log(`Sanitized prompt from "${originalPrompt}" to "${generationParams.prompt}"`);
                    }
                    
                    // Second retry: reduce image influence and further sanitize prompt
                    if (attempts === 3) {
                        if (generationParams.image_ref && generationParams.image_ref.length > 0) {
                            generationParams.image_ref[0].weight = 0.5; // Reduce image influence
                            console.log(`Reduced image reference weight to 0.5`);
                        }
                        
                        // Use a very generic prompt for the final attempt
                        generationParams.prompt = "A beautiful digital artwork";
                        console.log(`Using generic fallback prompt`);
                    }
                }
                
                // Make the API request
                generation = await client.generations.image.create(generationParams);
                break; // Success, exit the loop
                
            } catch (apiError) {
                console.error(`Attempt ${attempts} failed:`, apiError.message);
                
                // Store the error for later if it's moderation-related
                const errorMessage = apiError.message || '';
                if (errorMessage.includes('moderation') || 
                    errorMessage.includes('safety') || 
                    errorMessage.includes('content policy') ||
                    errorMessage.includes('rejected')) {
                    
                    moderationError = apiError;
                    // Continue to next attempt
                } else {
                    // If it's not a moderation error, throw immediately
                    throw apiError;
                }
            }
        }
        
        // If all attempts failed with moderation errors, return the last error
        if (!generation && moderationError) {
            return res.status(400).json({
                error: 'The image or prompt was rejected by content moderation after multiple attempts',
                details: moderationError.message,
                suggestion: 'Please try a completely different image or prompt that complies with content guidelines.'
            });
        }
        
        // If we have a successful generation, continue with normal flow
        if (generation) {
            // Generate a unique ID for this generation
            const generationId = generation.id;
            
            // Save metadata for reference
            if (!global.imageGenerations) {
                global.imageGenerations = {};
            }
            
            global.imageGenerations[generationId] = {
                title: title || `Image-${generationId.substring(0, 6)}`,
                client: clientName || "AI ABSTRACTIONS",
                background: background || "#f0f4ff",
                prompt: prompt, // Keep the original prompt for reference
                actualPrompt: generationParams.prompt, // Store the prompt that was actually used
                timestamp: new Date().toISOString(),
                attempts: attempts // Track how many attempts were needed
            };
            
            // Return a response to the client
            res.json({ 
                generationId: generationId, 
                id: generationId,
                state: generation.state,
                prompt: generationParams.prompt, // Return the prompt that was actually used
                originalPrompt: prompt, // Also return the original prompt for reference
                model: generation.model,
                message: 'Image generation started successfully',
                attempts: attempts
            });
        } else {
            // This should never happen due to our loop logic, but just in case
            throw new Error('Failed to generate image after multiple attempts');
        }
    } catch (error) {
        console.error('Error generating image:', error);
        
        res.status(500).json({ 
            error: error.message,
            suggestion: 'Check LumaAI documentation for proper request format'
        });
    }
});

// Endpoint to check status of image generation
app.get('/image-status/:generationId', async (req, res) => {
    try {
        // Check if LumaAI client is initialized
        if (!client) {
            return res.status(500).json({ 
                error: 'LumaAI client is not initialized', 
                suggestion: 'Check your LUMAAI_API_KEY environment variable.'
            });
        }
        
        const { generationId } = req.params;
        if (!generationId) {
            return res.status(400).json({ error: 'Generation ID is required' });
        }
        
        const status = await client.generations.get(generationId);
        
        if (status.state === 'completed') {
            // Get the image URL from the response
            const imageUrl = status.assets.image;
            
            // Get metadata from our stored object
            const imageData = global.imageGenerations && global.imageGenerations[generationId];
            
            // Create an image record for our storage
            if (imageUrl) {
                const imageRecord = {
                    id: generationId,
                    type: 'luma-image', // Mark as a Luma-generated image
                    url: imageUrl, // URL to the Luma-generated image
                    imageUrl: imageUrl, // Same URL for both fields for consistency
                    title: imageData?.title || `Image-${generationId.substring(0, 6)}`,
                    client: imageData?.client || "AI ABSTRACTIONS",
                    background: imageData?.background || "#f0f4ff",
                    prompt: imageData?.prompt || "No prompt available",
                    timestamp: new Date().toISOString()
                };
                
                // Add to our storage
                generatedVideos.push(imageRecord);
                
                // Save to JSON file
                saveVideosToFile();
            }
            
            // Return the status with the image URL
            return res.json({
                ...status,
                assets: {
                    ...status.assets || {},
                    image: imageUrl
                },
                state: status.state,
                id: generationId
            });
        } else if (status.state === 'failed') {
            return res.json({
                state: 'failed',
                failure_reason: status.failure_reason || 'Unknown failure reason',
                id: generationId
            });
        }
        
        // For in-progress states, just return the status
        res.json({
            ...status,
            id: generationId
        });
    } catch (error) {
        console.error('Error checking image status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start the server with error handling for port conflicts
let server;
const startServer = (port) => {
    return new Promise((resolve, reject) => {
        server = app.listen(port, () => {
            console.log(`Server running on http://localhost:${port}`);
            console.log(`Images stored in: ${IMAGES_DIR}`);
            resolve();
        }).on('error', (error) => {
            reject(error);
        });
    });
};

// Try the main port, fall back to alternative if needed
startServer(PORT)
    .then(() => {
        console.log(`Server successfully started on port ${PORT}`);
    })
    .catch((error) => {
        console.warn(`Error starting server on port ${PORT}: ${error.message}`);
        
        if (error.code === 'EADDRINUSE') {
            console.warn(`Port ${PORT} is already in use. Trying alternate port ${FALLBACK_PORT}...`);
            
            // Make sure we actually use the fallback port and don't just recurse
            startServer(FALLBACK_PORT)
                .then(() => {
                    console.log(`Server successfully started on fallback port ${FALLBACK_PORT}`);
                })
                .catch((err) => {
                    console.error(`Fatal error: Failed to start server on alternate port ${FALLBACK_PORT}: ${err.message}`);
                    process.exit(1);
                });
        } else {
            console.error(`Fatal error: Failed to start server: ${error.message}`);
            process.exit(1);
        }
    });