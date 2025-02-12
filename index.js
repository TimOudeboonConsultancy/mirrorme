import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';

const app = express();

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
  }

  async initialize() {
    console.log('Initializing TrelloSync...');
    for (const board of config.sourceBoards) {
      const lists = await trelloApi.getLists(board.id);
      for (const list of lists) {
        if (config.listNames.includes(list.name)) {
          this.listMapping.set(`${board.id}-${list.name}`, list.id);
        }
      }
    }
    const aggregateLists = await trelloApi.getLists(config.aggregateBoard);
    for (const list of aggregateLists) {
      if (config.listNames.includes(list.name)) {
        this.listMapping.set(`aggregate-${list.name}`, list.id);
      }
    }
    console.log('TrelloSync initialized');
  }

  async handleCardMove(card, sourceBoard, targetList) {
    console.log(`Handling card move for card ${card.id} on board ${sourceBoard.name}`);
    const cardMappingKey = `${sourceBoard.id}-${card.id}`;
    let mirroredCardId = this.cardMapping.get(cardMappingKey);
    if (!mirroredCardId && config.listNames.includes(targetList.name)) {
      const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);
      const mirroredCard = await trelloApi.createCard(aggregateListId, {
        ...card,
        desc: `Original board: ${sourceBoard.name}\n\n${card.desc || ''}`,
      });
      mirroredCardId = mirroredCard.id;
      this.cardMapping.set(cardMappingKey, mirroredCardId);
      console.log(`Created mirrored card ${mirroredCardId}`);
    } else if (mirroredCardId) {
      if (config.listNames.includes(targetList.name)) {
        const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);
        await trelloApi.updateCard(mirroredCardId, {
          idList: aggregateListId,
        });
        console.log(`Updated mirrored card ${mirroredCardId}`);
      } else {
        await trelloApi.deleteCard(mirroredCardId);
        this.cardMapping.delete(cardMappingKey);
        console.log(`Deleted mirrored card ${mirroredCardId}`);
      }
    }
  }

  async handleAggregateCardMove(card, targetList) {
    console.log(`Handling aggregate card move for card ${card.id}`);
    const boardMatch = card.desc.match(/Original board: (.*?)(?:\n|$)/);
    if (!boardMatch) {
      console.log('No original board info found in card description');
      return;
    }
    const sourceBoard = config.sourceBoards.find(b => b.name === boardMatch[1]);
    if (!sourceBoard) {
      console.log('Source board not found:', boardMatch[1]);
      return;
    }
    const originalCardId = Array.from(this.cardMapping.entries())
      .find(([_, mirroredId]) => mirroredId === card.id)?.[0]
      ?.split('-')[1];
    if (originalCardId) {
      const sourceListId = this.listMapping.get(`${sourceBoard.id}-${targetList.name}`);
      await trelloApi.updateCard(originalCardId, {
        idList: sourceListId,
      });
      console.log(`Updated original card ${originalCardId}`);
    } else {
      console.log('Original card not found in mapping');
    }
  }
}

// Initialize sync instance
const sync = new TrelloSync();

// Webhook validation function
function validateTrelloWebhook(req, res, next) {
  // Allow HEAD requests without validation
  if (req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Only validate POST requests with HMAC
  if (req.method === 'POST') {
    const callbackURL = 'https://mirrorme-jqjj87z9k-timothy-oudeboons-projects.vercel.app/webhook/card-moved';
    const base64Digest = crypto
      .createHmac('sha1', process.env.TRELLO_API_SECRET)
      .update(req.rawBody + callbackURL)
      .digest('base64');
    const doubleHash = crypto
      .createHmac('sha1', process.env.TRELLO_API_SECRET)
      .update(req.headers['x-trello-webhook'])
      .digest('base64');
    
    if (base64Digest === doubleHash) {
      return next();
    } else {
      return res.status(401).send('Unauthorized');
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

app.all('/webhook/card-moved', (req, res) => {
  console.log(`Webhook request received: ${req.method}`);
  console.log('Headers:', req.headers);

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

  // Validate and handle POST requests
  if (req.method === 'POST') {
    validateTrelloWebhook(req, res, () => {
      console.log('Webhook body:', req.body);
      if (req.body.action) {
        const { action } = req.body;
        if (action.type === 'updateCard' && action.data.listAfter) {
          const card = action.data.card;
          const board = action.data.board;
          const targetList = action.data.listAfter;
          if (board.id === config.aggregateBoard) {
            sync.handleAggregateCardMove(card, targetList).catch(console.error);
          } else {
            const sourceBoard = config.sourceBoards.find(b => b.id === board.id);
            if (sourceBoard) {
              sync.handleCardMove(card, sourceBoard, targetList).catch(console.error);
            }
          }
        }
      }
      res.sendStatus(200);
    });
  } else {
    res.sendStatus(405); // Method Not Allowed
  }
});

// Initialize sync on startup
sync.initialize().catch(console.error);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Trello sync service running on port ${port}`);
});