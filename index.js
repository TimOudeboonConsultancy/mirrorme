import express from 'express';
import { TrelloSync } from './trello-sync.js';
import { createWebhookRoutes, validateTrelloWebhook } from './webhook-handler.js';
import schedule from 'node-schedule';
import { config } from './config.js';

// Initialize express app
const app = express();

// Enhanced request body parsing middleware with rawBody capture
app.use(express.json({
  verify: (req, res, buf) => {
    // Store raw body for webhook validation
    req.rawBody = buf.toString();
  },
  limit: '10mb' // Increase limit if needed for larger payloads
}));

// Enhanced CORS middleware with logging
app.use((req, res, next) => {
  // Log the incoming request
  console.log(`${new Date().toISOString()} - Incoming ${req.method} request to ${req.path}`);

  // CORS headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Trello-Webhook');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    return res.sendStatus(200);
  }
  next();
});

// Enhanced request logging middleware
app.use((req, res, next) => {
  const requestStart = Date.now();

  // Log request details
  console.log('Request details:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    headers: {
      ...req.headers,
      // Redact any sensitive headers
      authorization: req.headers.authorization ? '[REDACTED]' : undefined,
      cookie: req.headers.cookie ? '[REDACTED]' : undefined
    },
    ip: req.ip,
    contentLength: req.headers['content-length']
  });

  // Add response logging
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - requestStart;
    console.log('Response details:', {
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      status: res.statusCode,
      contentLength: data?.length
    });
    return originalSend.apply(res, arguments);
  };

  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Initialize TrelloSync with error handling
const trelloSync = new TrelloSync();

// Create routes with the enhanced webhook handler
createWebhookRoutes(app, trelloSync);

// Set up daily scheduled job
const dailyJob = schedule.scheduleJob({
  hour: 0,
  minute: 0,
  tz: config.timezone
}, async () => {
  console.log('Daily scheduled job for card movement starting...');
  try {
    await trelloSync.performDailyCardMovement();
  } catch (error) {
    console.error('Error in daily scheduled job:', error);
  }
});

// Start server with enhanced logging and error handling
const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`=== Server Startup ===`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Server listening on port ${port}`);

  try {
    console.log('Initializing TrelloSync...');
    await trelloSync.initialize();
    console.log('TrelloSync initialization complete');
  } catch (error) {
    console.error('TrelloSync initialization failed:', {
      error: error.message,
      stack: error.stack
    });
    // Continue running the server even if sync initialization fails
    // This allows for manual recovery and webhook processing
  }
});