import { config } from './config.js';
import { trelloApi } from './trello-api.js';

// #region BOARD_CLEANING
async function clearProjectBoards() {
    // Combine source boards and aggregate board
    const boardsToClean = [
        ...config.sourceBoards,
        { id: config.aggregateBoard, name: 'Verzamelbord' }
    ];

    console.log('Starting project board card cleanup...');

    for (const board of boardsToClean) {
        try {
            console.log(`Clearing cards from board: ${board.name} (${board.id})`);
            const lists = await trelloApi.getLists(board.id);

            for (const list of lists) {
                const cards = await trelloApi.request(`/lists/${list.id}/cards`);
                console.log(`List "${list.name}" has ${cards.length} cards`);

                for (const card of cards) {
                    console.log(`Deleting card: ${card.name} (${card.id})`);
                    await trelloApi.deleteCard(card.id);
                }
            }
            console.log(`Finished clearing board: ${board.name}`);
        } catch (error) {
            console.error(`Error clearing board ${board.name}:`, error);
        }
    }

    console.log('Project board card cleanup complete!');
}
// #endregion BOARD_CLEANING

// Immediately invoke the cleanup function
clearProjectBoards().catch(console.error);