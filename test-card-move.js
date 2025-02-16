// test-card-move.js
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  apiKey: process.env.TRELLO_API_KEY,
  token: process.env.TRELLO_TOKEN,
  aggregateBoard: '67aca8e24e193b7fa5580831',  // Verzamelbord
  sourceBoards: [
    { id: '67aca823198750b8d3e332a4', name: 'prive' },
    { id: '67acb53d60d68b99ef11344d', name: 'mba' },
    { id: '67acb47a4c0afec8a06c9870', name: 'opdracht' },
    { id: '67acabbf06e3955d1e3be739', name: 'tim-oudeboon-bv' }
  ]
};

// Trello API helper
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
  }
};

async function testCardMove() {
  console.log('Starting card movement test...');

  try {
    // 1. Get lists from aggregate board
    console.log('\nFetching lists from aggregate board...');
    const aggregateLists = await trelloApi.getLists(config.aggregateBoard);
    console.log('Aggregate board lists:', aggregateLists.map(l => ({ id: l.id, name: l.name })));

    // 2. Get cards from aggregate board
    console.log('\nFetching cards from aggregate board...');
    const aggregateCards = await trelloApi.getCards(config.aggregateBoard);
    console.log(`Found ${aggregateCards.length} cards on aggregate board`);

    // 3. Find cards with original board info
    const cardsWithBoardInfo = aggregateCards.filter(card => 
      card.desc.includes('Original board:')
    );
    console.log(`\nFound ${cardsWithBoardInfo.length} cards with original board info:`);
    
    for (const card of cardsWithBoardInfo) {
      console.log('\nCard Details:');
      console.log(`- Name: ${card.name}`);
      console.log(`- ID: ${card.id}`);
      console.log(`- List: ${card.idList}`);
      console.log(`- Description: ${card.desc}`);
      
      // Extract original board info
      const boardMatch = card.desc.match(/Original board: (.*?)(?:\n|$)/);
      if (boardMatch) {
        const originalBoardName = boardMatch[1];
        console.log(`- Original Board: ${originalBoardName}`);
        
        // Find corresponding source board
        const sourceBoard = config.sourceBoards.find(b => b.name === originalBoardName);
        if (sourceBoard) {
          console.log(`- Found source board ID: ${sourceBoard.id}`);
          
          // Get lists from source board
          const sourceLists = await trelloApi.getLists(sourceBoard.id);
          console.log(`- Source board lists:`, sourceLists.map(l => ({ id: l.id, name: l.name })));
        } else {
          console.log('- WARNING: Source board not found in configuration');
        }
      }
    }

    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// Run the test
testCardMove().catch(console.error);