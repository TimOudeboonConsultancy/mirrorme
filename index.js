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
    console.log('Configured Source Boards:', JSON.stringify(config.sourceBoards, null, 2));
    console.log('Configured List Names:', JSON.stringify(config.listNames, null, 2));

    // Map lists for source boards
    for (const board of config.sourceBoards) {
      console.log(`Fetching lists for board: ${board.name} (${board.id})`);
      const lists = await trelloApi.getLists(board.id);
      console.log(`Lists found for ${board.name}:`, lists.map(l => l.name));
      
      for (const list of lists) {
        if (config.listNames.includes(list.name)) {
          const mappingKey = `${board.id}-${list.name}`;
          this.listMapping.set(mappingKey, list.id);
          console.log(`Mapped ${mappingKey} to list ID: ${list.id}`);
        }
      }
    }

    // Map lists for aggregate board
    console.log(`Fetching lists for aggregate board: ${config.aggregateBoard}`);
    const aggregateLists = await trelloApi.getLists(config.aggregateBoard);
    console.log('Aggregate board lists:', aggregateLists.map(l => l.name));
    
    for (const list of aggregateLists) {
      if (config.listNames.includes(list.name)) {
        const mappingKey = `aggregate-${list.name}`;
        this.listMapping.set(mappingKey, list.id);
        console.log(`Mapped ${mappingKey} to list ID: ${list.id}`);
      }
    }

    // Log final list mapping for verification
    console.log('Final List Mapping:');
    for (const [key, value] of this.listMapping.entries()) {
      console.log(`  ${key}: ${value}`);
    }

    console.log('TrelloSync initialized');
  }

  async handleCardMove(card, sourceBoard, targetList) {
    console.log(`Detailed Card Move Debug:
    Card ID: ${card.id}
    Card Name: ${card.name}
    Source Board: ${sourceBoard.name} (${sourceBoard.id})
    Target List Name: ${targetList.name}
    Configured List Names: ${JSON.stringify(config.listNames)}
    Configured Source Boards: ${JSON.stringify(config.sourceBoards.map(b => b.name))}
    Aggregate Board: ${config.aggregateBoard}`);

    // Check if the target list name is in the configured list names
    const isConfiguredList = config.listNames.includes(targetList.name);
    console.log(`Is target list configured? ${isConfiguredList}`);

    // Log the list mapping to verify correct list IDs
    console.log('List Mapping:');
    for (const [key, value] of this.listMapping.entries()) {
      console.log(`  ${key}: ${value}`);
    }

    const cardMappingKey = `${sourceBoard.id}-${card.id}`;
    let mirroredCardId = this.cardMapping.get(cardMappingKey);
    
    console.log(`Existing Mirrored Card ID for ${cardMappingKey}: ${mirroredCardId}`);

    if (!mirroredCardId && isConfiguredList) {
      const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);
      console.log(`Attempting to create mirrored card in list: ${aggregateListId}`);
      
      if (!aggregateListId) {
        console.error(`No aggregate list found for: aggregate-${targetList.name}`);
        return;
      }

      try {
        const mirroredCard = await trelloApi.createCard(aggregateListId, {
          ...card,
          desc: `Original board: ${sourceBoard.name}\n\n${card.desc || ''}`,
        });
        mirroredCardId = mirroredCard.id;
        this.cardMapping.set(cardMappingKey, mirroredCardId);
        console.log(`Created mirrored card ${mirroredCardId}`);
      } catch (error) {
        console.error('Error creating mirrored card:', error);
      }
    } else if (mirroredCardId) {
      if (isConfiguredList) {
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

  // Validate and handle POST requests
  if (req.method === 'POST') {
    validateTrelloWebhook(req, res, () => {
      if (req.body.action) {
        const { action } = req.body;
        
        // Enhanced logging for action details
        console.log('Action Type:', action.type);
        console.log('Action Details:', JSON.stringify(action, null, 2));

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
            } else {
              console.log(`Board ${board.id} not found in source boards`);
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