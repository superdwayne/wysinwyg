# DSS Application

This project consists of a backend server (Node.js/Express) and a frontend React application.

## Setup

First, install all dependencies for both the backend and frontend:

```bash
npm run install-all
```

## Development

To start both the backend server and frontend development server concurrently:

```bash
npm run dev
```

This will start:
- Backend server on port 5002 (with fallback to port 5003)
- Frontend React app on port 3000

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```
LUMAAI_API_KEY=your_lumaai_api_key
GROQ_API_KEY=your_groq_api_key
```

## Individual Commands

If you need to run the servers separately:

- Backend only: `npm run dev:server`
- Frontend only: `npm run dev:frontend`

## Troubleshooting

If you encounter port conflicts, the backend will automatically try port 5003 if port 5002 is in use.

To check which port the backend is running on, look for the console message:
```
Server running on http://localhost:PORT
```

The frontend will always use port 3000.
