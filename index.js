import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';

// Configuration
const config = {
  apiKey: process.env.TRELLO_API_KEY,
  token: process.env.TRELLO_TOKEN,
  sourceBoards: [
    { id: '67aca823198750b8d3e332a4', name: 'prive' },
    { id: '67acb53d60d68b99ef11344d', name: 'mba' },
    { id: '67acb47a4c0afec8a06c9870', name: 'opdracht' },
    { id: '67acabbf06e3955d1e3be739', name: 'tim-oudeboon-bv' }
  ],
  aggregateBoard: '67aca8e24e193b7fa5580831',
  listNames: ['Komende 30 dagen', 'Komende 7 dagen', 'Vandaag', 'Done'],
};

// Trello API helper functions
const trelloApi = {
  baseUrl: 'https://api.trello.com/1',
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}?key=${config.apiKey}&token=${config.token}`;
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Trello API error: ${response.statusText}`);
    }
    return response.json();
  },
  async getBoard(boardId) {
    return this.request(`/boards/${boardId}`);
  },
  async getLists(boardId) {
    return this.request(`/boards/${boardId}/lists`);
  },
  async getCards(boardId) {
    return this.request(`/boards/${boardId}/cards`);
  },
  async createCard(listId, cardData) {
    return this.request(`/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idList: listId,
        name: cardData.name,
        desc: cardData.desc,
        due: cardData.due,
        ...cardData
      })
    });
  },
  async updateCard(cardId, updates) {
    return this.request(`/cards/${cardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  },
  async deleteCard(cardId) {
    return this.request(`/cards/${cardId}`, {
      method: 'DELETE'
    });
  }
};

// Card synchronization logic
class TrelloSync {
  constructor() {
    this.listMapping = new Map();
    this.cardMapping = new Map();

    // Define color mapping for different boards
    this.boardColorMap = {
      'prive': 'green_dark',
      'mba': 'blue_dark',
      'opdracht': 'purple_dark',
      'tim-oudeboon-bv': 'orange_dark'
    };
  }

  // [Previous methods remain the same: initialize, handleCardMove, handleAggregateCardMove]
  // (Methods as shown in the previous response)
}

// Initialize express app and sync instance
const app = express();
const trelloSync = new TrelloSync();

// Parse raw body for webhook validation
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Add CORS support
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  next();
});

// Webhook validation function
function validateTrelloWebhook(req, res, next) {
  // Allow HEAD requests without validation
  if (req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Only validate POST requests with HMAC
  if (req.method === 'POST') {
    const callbackURL = 'https://trello-sync-mirror-f28465526010.herokuapp.com/webhook/card-moved';

    try {
      // Extensive logging for debugging
      console.log('Webhook Validation Detailed Debug:');
      console.log('Request Method:', req.method);
      console.log('Raw Body Length:', req.rawBody ? req.rawBody.length : 'NO RAW BODY');
      console.log('Callback URL:', callbackURL);
      console.log('All Headers:', JSON.stringify(req.headers, null, 2));
      console.log('X-Trello-Webhook Header:', req.headers['x-trello-webhook']);
      console.log('API Secret Present:', !!process.env.TRELLO_API_SECRET);

      // First, verify the presence of the webhook signature
      const trelloSignature = req.headers['x-trello-webhook'];
      if (!trelloSignature) {
        console.error('No Trello webhook signature found');
        return res.status(401).send('Unauthorized: Missing webhook signature');
      }

      // Verify the API secret is present
      if (!process.env.TRELLO_API_SECRET) {
        console.error('Trello API Secret is not set');
        return res.status(500).send('Internal Server Error: Missing API Secret');
      }

      // Validate the body is not empty
      if (!req.rawBody) {
        console.error('Raw body is empty');
        return res.status(400).send('Bad Request: Empty body');
      }

      // Compute HMAC signature
      const hmac = crypto.createHmac('sha1', process.env.TRELLO_API_SECRET);
      const computedSignature = hmac
          .update(req.rawBody + callbackURL)
          .digest('base64');

      console.log('Received Signature:', trelloSignature);
      console.log('Computed Signature:', computedSignature);

      // Validate the signature
      if (computedSignature === trelloSignature) {
        return next();
      } else {
        console.error('Webhook signature validation failed');
        console.error('Signature Mismatch:');
        console.error('Received:', trelloSignature);
        console.error('Computed:', computedSignature);
        return res.status(401).send('Unauthorized: Invalid webhook signature');
      }
    } catch (error) {
      console.error('Webhook validation error:', error);
      return res.status(500).send('Internal Server Error');
    }
  }

  // Allow GET requests for health checks
  if (req.method === 'GET') {
    return next();
  }

  // Deny other methods
  res.status(405).send('Method Not Allowed');
}

// Define routes
app.get('/', (req, res) => {
  res.send('Trello Sync Service is running!');
});

app.all('/webhook/card-moved', validateTrelloWebhook, (req, res) => {
  console.log(`Webhook request received: ${req.method}`);
  console.log('Webhook headers:', JSON.stringify(req.headers, null, 2));
  console.log('Webhook body:', JSON.stringify(req.body, null, 2));

  // Immediately return 200 for HEAD requests
  if (req.method === 'HEAD') {
    return res.sendStatus(200);
  }

  // Handle OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  // Handle GET requests (health checks)
  if (req.method === 'GET') {
    return res.status(200).send('Webhook endpoint is active');
  }

  // Handle POST requests
  if (req.method === 'POST') {
    if (req.body.action) {
      const { action } = req.body;

      // Enhanced logging for action details
      console.log('Action Type:', action.type);
      console.log('Action Details:', JSON.stringify(action, null, 2));

      // Handle both createCard and updateCard events
      if ((action.type === 'updateCard' || action.type === 'createCard') &&
          action.data && action.data.board) {

        const card = action.data.card;
        const board = action.data.board;
        console.log('Available list data:', {
          listAfter: action.data.listAfter,
          list: action.data.list
        });
        const targetList = action.data.listAfter || action.data.list;
        console.log('Selected target list:', targetList);

        if (board.id === config.aggregateBoard) {
          trelloSync.handleAggregateCardMove(card, targetList).catch(console.error);
        } else {
          const sourceBoard = config.sourceBoards.find(b => b.id === board.id);
          if (sourceBoard) {
            if (config.listNames.includes(targetList.name)) {
              trelloSync.handleCardMove(card, sourceBoard, targetList).catch(console.error);
            } else {
              console.log(`List ${targetList.name} not in configured lists`);
            }
          } else {
            console.log(`Board ${board.id} not found in source boards`);
          }
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(405); // Method Not Allowed
  }
});

// Start server and initialize sync
const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`Trello sync service running on port ${port}`);
  await trelloSync.initialize().catch(console.error);
});