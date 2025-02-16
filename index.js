import express from 'express';
import { TrelloSync } from './trello-sync.js';
import { createWebhookRoutes, validateTrelloWebhook } from './webhook-handler.js';

// Initialize express app and sync instance
const app = express();

// Middleware
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// CORS and logging middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  next();
});

// Initialize TrelloSync and create routes
const trelloSync = new TrelloSync();
createWebhookRoutes(app, trelloSync);

// Start server and initialize sync
const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`Trello sync service running on port ${port}`);
  await trelloSync.initialize().catch(console.error);
});