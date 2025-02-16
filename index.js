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
    console.log(`Detailed Card Move/Create Debug:
    Card ID: ${card.id}
    Card Name: ${card.name}
    Source Board: ${sourceBoard.name} (${sourceBoard.id})
    Target List Name: ${targetList.name}
    Configured List Names: ${JSON.stringify(config.listNames)}
    Configured Source Boards: ${JSON.stringify(config.sourceBoards.map(b => b.name))}
    Aggregate Board: ${config.aggregateBoard}`);

    const isConfiguredList = config.listNames.includes(targetList.name);
    console.log(`Is target list configured? ${isConfiguredList}`);

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
        // Fetch full card details to ensure we get all labels
        const fullCard = await trelloApi.request(`/cards/${card.id}`);
        console.log('Full card details:', JSON.stringify(fullCard, null, 2));

        // Create a new origin label on the aggregate board matching the source board
        const originLabelName = `Origin:${sourceBoard.name}`;
        let originLabelId = null;

        try {
          // Try to get existing label
          const labels = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`);
          const existingLabel = labels.find(l => l.name === originLabelName);

          if (existingLabel) {
            originLabelId = existingLabel.id;
            console.log(`Found existing label: ${originLabelName}, ID: ${originLabelId}`);
          } else {
            // Create a new label if it doesn't exist
            const newLabel = await trelloApi.request(`/labels`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: originLabelName,
                color: 'blue_dark', // You can customize this color
                idBoard: config.aggregateBoard
              })
            });
            originLabelId = newLabel.id;
            console.log(`Created new label: ${originLabelName}, ID: ${originLabelId}`);
          }
        } catch (labelError) {
          console.error('Error handling label:', labelError);
        }

        // Combine original card's labels with the new origin label
        const labelIds = fullCard.labels.map(label => label.id);
        if (originLabelId) {
          labelIds.push(originLabelId);
        }

        const mirroredCard = await trelloApi.createCard(aggregateListId, {
          name: card.name,
          desc: `Original board: ${sourceBoard.name}\n\n${card.desc || ''}`,
          due: card.due,
          idLabels: labelIds
        });

        mirroredCardId = mirroredCard.id;
        this.cardMapping.set(cardMappingKey, mirroredCardId);
        console.log(`Created mirrored card ${mirroredCardId} with labels: ${labelIds.join(', ')}`);
      } catch (error) {
        console.error('Error creating mirrored card:', error);
      }
    } else if (mirroredCardId) {
      if (isConfiguredList) {
        // Fetch full card details to ensure we get all labels
        const fullCard = await trelloApi.request(`/cards/${card.id}`);

        const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);

        await trelloApi.updateCard(mirroredCardId, {
          idList: aggregateListId,
          idLabels: fullCard.labels.map(label => label.id)
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
    console.log('=== Starting handleAggregateCardMove ===');
    console.log(`Processing card: ${card.name} (${card.id})`);
    console.log(`Target list: ${targetList.name}`);

    // Check if card has a description
    if (!card.desc) {
      console.log('Card has no description, fetching full card details...');
      try {
        card = await trelloApi.request(`/cards/${card.id}`);
      } catch (error) {
        console.error('Error fetching card details:', error);
        return;
      }
    }

    // Extract original board info from card description
    const boardMatch = card.desc ? card.desc.match(/Original board: (.*?)(?:\n|$)/) : null;
    if (!boardMatch) {
      console.log('No original board info found in card description:', card.desc);
      return;
    }

    const originalBoardName = boardMatch[1];
    console.log(`Original board name found: ${originalBoardName}`);

    // Find the source board configuration
    const sourceBoard = config.sourceBoards.find(b => b.name === originalBoardName);
    if (!sourceBoard) {
      console.log(`Source board not found for name: ${originalBoardName}`);
      return;
    }
    console.log(`Found source board: ${sourceBoard.name} (${sourceBoard.id})`);

    // Find the original card ID from the mapping
    let originalCardId = null;
    for (const [mappingKey, mirroredId] of this.cardMapping.entries()) {
      if (mirroredId === card.id) {
        const [boardId, cardId] = mappingKey.split('-');
        if (boardId === sourceBoard.id) {
          originalCardId = cardId;
          break;
        }
      }
    }

    if (!originalCardId) {
      console.log('Original card not found in mapping. Current mapping:',
          Array.from(this.cardMapping.entries()));
      return;
    }
    console.log(`Found original card ID: ${originalCardId}`);

    // Get the corresponding list ID on the source board
    const sourceListId = this.listMapping.get(`${sourceBoard.id}-${targetList.name}`);
    if (!sourceListId) {
      console.log(`No matching list found on source board for: ${targetList.name}`);
      console.log('Current list mapping:', Array.from(this.listMapping.entries()));
      return;
    }
    console.log(`Found source list ID: ${sourceListId}`);

    try {
      // Update the card on the original board
      await trelloApi.updateCard(originalCardId, {
        idList: sourceListId,
      });
      console.log(`Successfully updated original card ${originalCardId} to list ${sourceListId}`);
    } catch (error) {
      console.error('Error updating original card:', error);
      throw error;
    }
  }
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