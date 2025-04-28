import React, { useState, useEffect } from 'react';
import './VideoGenerator.css';

const VideoGenerator = () => {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('ray-2');
  const [status, setStatus] = useState('');
  const [videoUrl, setVideoUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [generationId, setGenerationId] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);

  // Cleanup polling when component unmounts
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  // Start polling when we have a generationId
  useEffect(() => {
    if (generationId && isLoading) {
      // Poll every 5 seconds
      const interval = setInterval(checkVideoStatus, 5000);
      setPollingInterval(interval);
      
      // Initial status check
      checkVideoStatus();
      
      return () => clearInterval(interval);
    }
  }, [generationId, isLoading]);

  const checkVideoStatus = async () => {
    if (!generationId) return;
    
    try {
      const response = await fetch(`http://localhost:5007/video-status/${generationId}`);
      const data = await response.json();
      
      if (response.ok) {
        setStatus(`Status: ${data.state}`);
        
        if (data.completed && data.videoUrl) {
          setVideoUrl(data.videoUrl);
          setStatus('Video generated successfully!');
          setIsLoading(false);
          
          if (pollingInterval) {
            clearInterval(pollingInterval);
            setPollingInterval(null);
          }
        }
      } else {
        setStatus(`Error: ${data.error || 'Failed to check status'}`);
        setIsLoading(false);
        
        if (pollingInterval) {
          clearInterval(pollingInterval);
          setPollingInterval(null);
        }
      }
    } catch (error) {
      console.error('Error checking video status:', error);
      setStatus('Error checking status. Will retry...');
    }
  };

  const generateVideo = async () => {
    if (!prompt.trim()) {
      setStatus('Please enter a prompt');
      return;
    }

    try {
      // Reset state
      setIsLoading(true);
      setStatus('Starting video generation...');
      setVideoUrl(null);
      setGenerationId(null);
      
      if (pollingInterval) {
        clearInterval(pollingInterval);
        setPollingInterval(null);
      }
      
      // Request video generation
      const response = await fetch('http://localhost:5007/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model }),
      });

      const data = await response.json();
      
      if (response.ok && data.generationId) {
        setGenerationId(data.generationId);
        setStatus(`Generation started. ID: ${data.generationId.substring(0, 8)}...`);
      } else {
        setStatus(`Error: ${data.error || 'Failed to start generation'}`);
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Error:', error);
      setStatus('Connection error. Please check if the server is running.');
      setIsLoading(false);
    }
  };

  return (
    <div className="video-generator-container">
      <h1>Luma AI Video Generator</h1>
      
      <div className="input-group">
        <textarea
          placeholder="Enter a detailed description of the video you want to generate..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isLoading}
          rows={4}
        />
      </div>
      
      <div className="controls">
        <div className="model-selector">
          <label>Model:</label>
          <select 
            value={model} 
            onChange={(e) => setModel(e.target.value)}
            disabled={isLoading}
          >
            <option value="ray-2">Ray-2</option>
          </select>
        </div>
        
        <button 
          onClick={generateVideo} 
          disabled={isLoading || !prompt.trim()}
        >
          {isLoading ? 'Generating...' : 'Generate Video'}
        </button>
      </div>
      
      <div className="status-container">
        <div className={`status ${isLoading ? 'loading' : ''}`}>
          {status}
        </div>
        
        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <p>Video generation can take 1-2 minutes. Please wait...</p>
          </div>
        )}
        
        {videoUrl && (
          <div className="video-result">
            <h3>Your Generated Video:</h3>
            <video 
              controls 
              src={videoUrl} 
              width="100%" 
             
              loop
              playsInline
            />
            <div className="video-actions">
              <a 
                href={videoUrl} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="download-link"
                download="luma-generated-video.mp4"
              >
                Download Video
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoGenerator;